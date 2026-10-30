import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

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
    expect(okValueFrom(await services.sessions.getReview({ sessionId })).headSha).toBe(secondHead);
    held.release();

    const prepared = okValueFrom(await preparing);
    expect(held.compiledAt()).toStrictEqual([firstHead]);
    expect(prepared.preview).toMatchObject({ headSha: firstHead, inlineCount: 1, bodyCount: 0 });
    expect(prepared.payload).toMatchObject({
      commit_id: firstHead,
      comments: [{ path: 'app.ts', line: 1 }],
    });
  });
});

/** Holds `compileArtifact` until `release`, recording the head each call asked for. */
function holdCompile(ura: UraServices): {
  readonly ura: Pick<UraServices, 'compileArtifact' | 'listPostings'>;
  readonly arrived: Promise<undefined>;
  readonly release: () => void;
  readonly compiledAt: () => readonly string[];
} {
  const arrived = Promise.withResolvers<undefined>();
  const gate = Promise.withResolvers<undefined>();
  const heads: string[] = [];
  return {
    ura: {
      compileArtifact: async (
        sessionId: string,
        options: CompileArtifactOptions,
      ): ReturnType<UraServices['compileArtifact']> => {
        heads.push(options.headSha);
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
    compiledAt: (): readonly string[] => heads,
  };
}
