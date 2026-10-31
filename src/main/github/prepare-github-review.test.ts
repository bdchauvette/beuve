import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { createGitCaches } from '../sessions/create-git-caches.ts';
import type { SessionContext } from '../sessions/session-context.ts';
import { lines } from '../testing/lines.ts';
import { createUraServices } from '../ura/create-ura-services.ts';
import type { CompileArtifactOptions, UraServices } from '../ura/create-ura-services.ts';
import { prepareGithubReview } from './prepare-github-review.ts';
import { test } from './testing/test.ts';

describe('prepareGithubReview (integration: fake GitHub, local bare remote)', () => {
  test('uses the one head it checked when the head moves while the review compiles', async ({
    expect,
    services,
    opened,
    db,
    deps,
    logger,
    world,
    signal,
  }) => {
    const { upstream, bare, api, firstHead } = world;
    const sessionId = await opened();
    okValueFrom(
      await services.ura.create({
        sessionId,
        anchor: { kind: 'lines', path: 'app.ts', startLine: 1, endLine: 1 },
        severity: 'issue',
        title: 'Name the constant',
        body: '42 needs a name.',
      }),
    );
    const session: SessionContext = {
      db,
      deps,
      logger: logger.logger,
      git: { logger: logger.logger },
      caches: createGitCaches(),
    };
    const held = holdCompile(createUraServices({ context: session, impact: services.impact }));
    const context = { session };

    const preparing = prepareGithubReview(context, held.ura, {
      sessionId,
      expectedHeadSha: firstHead,
    });
    await held.arrived;
    upstream.write('app.ts', lines(['export const answer = 42;', 'export const other = 3;']));
    const secondHead = await upstream.commit('pushed mid-post');
    await upstream.git('push', '--quiet', bare, 'feature:refs/pull/7/head');
    Object.assign(api.pullRequests.get(7) ?? {}, {
      headSha: secondHead,
      updatedAt: '2026-10-28T11:00:00Z',
    });
    await services.github.pollNow(sessionId);
    expect(okValueFrom(await services.sessions.getReview({ sessionId }, { signal })).headSha).toBe(
      secondHead,
    );
    held.release();

    const prepared = okValueFrom(await preparing);
    expect(held.compiledAt()).toStrictEqual([firstHead]);
    expect(prepared.preview).toMatchObject({ headSha: firstHead, inlineCount: 1, bodyCount: 0 });
    expect(prepared.payload).toMatchObject({
      commit_id: firstHead,
      comments: [{ path: 'app.ts', line: 1 }],
    });
  });

  test('uses the one base tip it resolved when the base is fetched while the review compiles', async ({
    expect,
    services,
    opened,
    db,
    deps,
    logger,
    world,
  }) => {
    const { clone, firstHead, baseSha } = world;
    const sessionId = await opened();
    const session: SessionContext = {
      db,
      deps,
      logger: logger.logger,
      git: { logger: logger.logger },
      caches: createGitCaches(),
    };
    const held = holdCompile(createUraServices({ context: session, impact: services.impact }));
    const preparing = prepareGithubReview({ session }, held.ura, {
      sessionId,
      expectedHeadSha: firstHead,
    });
    await held.arrived;
    const tree = await clone.git('show', '--no-patch', '--format=%T', baseSha);
    const landed = await clone.git('commit-tree', tree, '-p', baseSha, '-m', 'landed on main');
    await clone.git('update-ref', 'refs/beuve/pr/7/base', landed);
    held.release();

    const prepared = okValueFrom(await preparing);
    expect(held.compiledFrom()).toStrictEqual([baseSha]);
    expect(prepared.preview).toMatchObject({ headSha: firstHead });
  });
});

/** URA services whose `compileArtifact` waits for `release`, and what each call asked for. */
interface HeldCompile {
  readonly ura: Pick<UraServices, 'compileArtifact' | 'listPostings'>;
  readonly arrived: Promise<undefined>;
  readonly release: () => void;
  readonly compiledAt: () => readonly string[];
  /** The base tip each call was pinned to. */
  readonly compiledFrom: () => readonly (string | undefined)[];
}

/** Holds `compileArtifact` until `release`, recording the head each call asked for. */
function holdCompile(ura: UraServices): HeldCompile {
  const arrived = Promise.withResolvers<undefined>();
  const gate = Promise.withResolvers<undefined>();
  const heads: string[] = [];
  const bases: (string | undefined)[] = [];
  return {
    ura: {
      compileArtifact: async (
        sessionId: string,
        options: CompileArtifactOptions,
      ): ReturnType<UraServices['compileArtifact']> => {
        heads.push(options.headSha);
        bases.push(options.baseTip);
        arrived.resolve(undefined);
        await gate.promise;
        return ura.compileArtifact(sessionId, options);
      },
      listPostings: ura.listPostings,
    },
    arrived: arrived.promise,
    release: (): void => {
      gate.resolve(undefined);
    },
    compiledAt: (): readonly string[] => {
      return heads;
    },
    compiledFrom: (): readonly (string | undefined)[] => {
      return bases;
    },
  };
}
