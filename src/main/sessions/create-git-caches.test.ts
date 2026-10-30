import { describe } from 'vitest';
import type { ExpectStatic } from 'vitest';

import type { RepositoryTemplate, TestRepository } from '#internal/git/testing/test-repository.ts';
import type { RecordingLogger } from '#testing/test.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';
import { createLogger } from '#x/log/create-logger.ts';

import type { MainServices } from '../main-services.ts';
import { test } from '../testing/test.ts';

describe('the shared git caches (ADR 0081)', { timeout: 60_000 }, () => {
  test('a review answers the same with and without caching, with fewer git runs', async ({
    expect,
    createServices,
    repositories,
    signal,
  }) => {
    const { repo } = await repositories.fromTemplate(importingBranchTemplate());
    const cachedGit = recordingLogger();
    const uncachedGit = recordingLogger();
    const cached = createServices({ git: { logger: cachedGit.logger } });
    const uncached = createServices({ git: { logger: uncachedGit.logger }, caching: false });
    const { id: sessionId } = okValueFrom(
      await cached.sessions.createLocal({
        repoPath: repo.directory,
        baseRef: 'main',
        headRef: 'feature',
      }),
    );

    const full = await expectSameReview(expect, cached, uncached, sessionId, signal);
    expect(full.scope).toStrictEqual({ kind: 'full' });
    okValueFrom(await cached.sessions.markReviewed({ sessionId, expectedHeadSha: full.headSha }));
    const upToDate = await expectSameReview(expect, cached, uncached, sessionId, signal);
    expect(upToDate.scope).toStrictEqual({ kind: 'up-to-date' });

    await repo.git('switch', '--quiet', 'main');
    repo.write('base.ts', 'export const base = 2;\n');
    await repo.commit('upstream');
    await repo.git('switch', '--quiet', 'feature');
    await repo.git('rebase', '--quiet', 'main');
    repo.write('src/b.ts', "import { a } from './a.ts';\nexport const b = a + 3;\n");
    await repo.commit('feature: b again');
    const interdiff = await expectSameReview(expect, cached, uncached, sessionId, signal);
    expect(interdiff.scope).toMatchObject({ kind: 'interdiff', outcome: { kind: 'rebased' } });

    const cachedRuns = gitRuns(cachedGit);
    const uncachedRuns = gitRuns(uncachedGit);
    expect(cachedRuns.filter((args) => args[0] === '--version')).toHaveLength(1);
    expect(uncachedRuns.filter((args) => args[0] === '--version').length).toBeGreaterThan(10);
    expect(wholeRangeDiffs(cachedRuns)).toBe(4);
    expect(wholeRangeDiffs(uncachedRuns)).toBeGreaterThan(12);
  });
});

type Review = Awaited<ReturnType<MainServices['sessions']['getReview']>>;

/**
 * Asks both services for everything a review shows, twice over for the cached side so its second
 * answers come from the caches, and expects each answer to match. Returns the plain review.
 */
async function expectSameReview(
  expect: ExpectStatic,
  cached: MainServices,
  uncached: MainServices,
  sessionId: string,
  signal: AbortSignal,
): Promise<Extract<Review, { ok: true }>['value']> {
  const ask = async (services: MainServices): Promise<unknown[]> => {
    const review = await services.sessions.getReview({ sessionId }, { signal });
    const ignoring = await services.sessions.getReview(
      { sessionId, ignoreWhitespace: true },
      { signal },
    );
    const paths = review.ok ? review.value.files.map((file) => file.path) : [];
    const headSha = review.ok ? review.value.headSha : '';
    const [order, attributes, tree, pairs, sheets] = await Promise.all([
      services.order.getOrder({ sessionId, mode: 'imports' }, { signal }),
      services.files.getFileAttributes({ sessionId }, { signal }),
      services.files.getTree({ sessionId }, { signal }),
      Promise.all(paths.map(async (path) => services.files.getFilePair({ sessionId, path }))),
      Promise.all(
        paths.map(async (path) =>
          services.sheets.getFile({ sessionId, sha: headSha, path }, { signal }),
        ),
      ),
    ]);
    return [review, ignoring, order, attributes, tree, pairs, sheets];
  };
  const reference = await ask(uncached);
  await expect(ask(cached)).resolves.toStrictEqual(reference);
  await expect(ask(cached)).resolves.toStrictEqual(reference);
  return okValueFrom(reference[0] as Review);
}

function recordingLogger(): RecordingLogger {
  const lines: Readonly<Record<string, unknown>>[] = [];
  const logger = createLogger('git', {
    level: 'debug',
    sink: (line): void => {
      lines.push(JSON.parse(line) as Readonly<Record<string, unknown>>);
    },
  });
  return { logger, lines };
}

function gitRuns(recorded: RecordingLogger): (readonly string[])[] {
  return recorded.lines
    .filter((line) => line['message'] === 'git')
    .map((line) => line['args'] as readonly string[]);
}

/** Diffs of a whole range: nothing after `--`, so not a sheet's one-file diff. */
function wholeRangeDiffs(runs: readonly (readonly string[])[]): number {
  return runs.filter((args) => args[0] === 'diff' && args.at(-1) === '--').length;
}

function importingBranchTemplate(): RepositoryTemplate<undefined> {
  return { name: 'git caches: importing branch', build: importingBranch };
}

async function importingBranch(repo: TestRepository): Promise<undefined> {
  repo.write('base.ts', 'export const base = 1;\n');
  repo.write('src/a.ts', 'export const a = 1;\n');
  repo.write('src/b.ts', "import { a } from './a.ts';\nexport const b = a;\n");
  repo.write('src/c.ts', "import { b } from './b.ts';\nexport const c = b;\n");
  await repo.commit('base');
  await repo.git('switch', '--quiet', '-c', 'feature');
  repo.write('src/a.ts', 'export const a = 2;\n');
  repo.write('src/b.ts', "import { a } from './a.ts';\nexport const b = a + 1;\n");
  repo.write('src/c.ts', "import { b } from './b.ts';\n\nexport const c  = b;\n");
  repo.write('src/d.ts', "import { c } from './c.ts';\nexport const d = c;\n");
  await repo.commit('feature');
  return undefined;
}
