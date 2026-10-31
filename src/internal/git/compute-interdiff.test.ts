import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { computeInterdiff } from './compute-interdiff.ts';
import type { DiffFile } from './diff-model.ts';
import { diffObjects } from './diff-objects.ts';
import type { CommitSha } from './object-id.ts';
import type { ReviewRange } from './review-range.ts';
import type { TestRepository } from './testing/test-repository.ts';
import { test } from './testing/test.ts';

describe('computeInterdiff', () => {
  test('diffs heads directly when the fork point is unchanged', async ({
    expect,
    repo,
    repository: git,
  }) => {
    const previous = await reviewedBranch(repo);
    repo.write('feature.rs', lines(['pub fn feature() -> u8 {', '  2', '}']));
    const head = await repo.commit('fixup');
    const result = await computeInterdiff(git, previous, { base: previous.base, head });
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'exact', nextMergeBase: previous.base },
    });
    expect(summary(okValueFrom(result).files)).toStrictEqual([['feature.rs', ['-  1', '+  2']]]);

    await expect(computeInterdiff(git, previous, previous)).resolves.toMatchObject({
      ok: true,
      value: { kind: 'exact', files: [] },
    });
  });

  test('shows only the amendment after a rebase onto an advanced base', async ({
    expect,
    repo,
    repository: git,
  }) => {
    const previous = await reviewedBranch(repo);
    const newBase = await upstreamAdvances(repo);
    await repo.git('switch', '--quiet', 'topic');
    await repo.git('rebase', '--quiet', 'main');
    const head = await amendFeature(repo, lines(['pub fn feature() -> u8 {', '  42', '}']));
    const next = { base: newBase, head };

    const result = await computeInterdiff(git, previous, next);
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'rebased', previousMergeBase: previous.base, nextMergeBase: newBase },
    });
    expect(summary(okValueFrom(result).files)).toStrictEqual([['feature.rs', ['-  1', '+  42']]]);

    const naive = await diffObjects(git, previous.head, head);
    expect(summary(okValueFrom(naive)).map(([path]) => path)).toStrictEqual([
      'feature.rs',
      'lib.rs',
      'upstream.rs',
    ]);
  });

  test('reports no changes for a pure rebase', async ({ expect, repo, repository: git }) => {
    const previous = await reviewedBranch(repo);
    const newBase = await upstreamAdvances(repo);
    await repo.git('switch', '--quiet', 'topic');
    await repo.git('rebase', '--quiet', 'main');
    const head = (await repo.git('rev-parse', 'HEAD')) as CommitSha;
    await expect(computeInterdiff(git, previous, { base: newBase, head })).resolves.toMatchObject({
      ok: true,
      value: { kind: 'rebased', files: [] },
    });
  });

  test('works on git 2.38–2.39 when the old fork point is an ancestor of the new one', async ({
    expect,
    repo,
    repository: git,
  }) => {
    const previous = await reviewedBranch(repo);
    const newBase = await upstreamAdvances(repo);
    await repo.git('switch', '--quiet', 'topic');
    await repo.git('rebase', '--quiet', 'main');
    const head = await amendFeature(repo, lines(['pub fn feature() -> u8 {', '  42', '}']));
    const older = { ...git, version: { major: 2, minor: 39, patch: 3, raw: 'git version 2.39.3' } };
    const result = await computeInterdiff(older, previous, { base: newBase, head });
    expect(result).toMatchObject({ ok: true, value: { kind: 'rebased' } });
    expect(summary(okValueFrom(result).files)).toStrictEqual([['feature.rs', ['-  1', '+  42']]]);
  });

  test('falls back to the full new range when replaying the reviewed changes conflicts', async ({
    expect,
    repo,
    repository: git,
  }) => {
    const previous = await reviewedBranch(repo);
    await repo.git('switch', '--quiet', 'main');
    repo.write('app.rs', lines(appLines().with(2, '  run_upstream();')));
    const newBase = await repo.commit('upstream touches the same line');
    await repo.git('switch', '--quiet', 'topic');
    await repo.git('rebase', '--quiet', '--strategy-option=theirs', 'main');
    const head = (await repo.git('rev-parse', 'HEAD')) as CommitSha;

    const result = await computeInterdiff(git, previous, { base: newBase, head });
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'fallback', reason: { kind: 'conflicts', paths: ['app.rs'] } },
    });
    expect(summary(okValueFrom(result).files).map(([path]) => path)).toStrictEqual([
      'app.rs',
      'feature.rs',
    ]);
  });

  test('falls back when git is too old to synthesize the replay', async ({
    expect,
    repo,
    repository: git,
  }) => {
    const previous = await reviewedBranch(repo);
    const newBase = await upstreamAdvances(repo);
    await repo.git('switch', '--quiet', 'topic');
    await repo.git('rebase', '--quiet', 'main');
    const head = (await repo.git('rev-parse', 'HEAD')) as CommitSha;
    const ancient = {
      ...git,
      version: { major: 2, minor: 37, patch: 0, raw: 'git version 2.37.0' },
    };
    await expect(
      computeInterdiff(ancient, previous, { base: newBase, head }),
    ).resolves.toMatchObject({
      ok: true,
      value: { kind: 'fallback', reason: { kind: 'git-too-old', required: '2.38' } },
    });
  });
});

function lines(content: readonly string[]): string {
  return `${content.join('\n')}\n`;
}

/** Each file's path with its changed lines, `-`/`+` prefixed. */
function summary(files: readonly DiffFile[]): [string, string[]][] {
  return files.map((file) => {
    return [
      'path' in file ? file.path : file.newPath,
      file.hunks.flatMap((hunk) => {
        return hunk.lines
          .filter((line) => line.kind !== 'context')
          .map((line) => {
            return `${line.kind === 'added' ? '+' : '-'}${line.content}`;
          });
      }),
    ];
  });
}

function appLines(): readonly string[] {
  return ['fn main() {', '  setup();', '  run();', '  teardown();', '}'];
}

/** main: app + lib; topic: edits app, adds feature. Returns the reviewed range. */
async function reviewedBranch(repo: TestRepository): Promise<ReviewRange> {
  repo.write('app.rs', lines(appLines()));
  repo.write('lib.rs', lines(['pub fn lib() {}']));
  const base = await repo.commit('base');
  await repo.git('switch', '--quiet', '--create', 'topic');
  repo.write('app.rs', lines(appLines().with(2, '  run_fast();')));
  await repo.commit('speed up');
  repo.write('feature.rs', lines(['pub fn feature() -> u8 {', '  1', '}']));
  const head = await repo.commit('add feature');
  return { base, head };
}

async function upstreamAdvances(repo: TestRepository): Promise<CommitSha> {
  await repo.git('switch', '--quiet', 'main');
  repo.write('lib.rs', lines(['pub fn lib() {}', 'pub fn more() {}']));
  await repo.commit('upstream lib');
  repo.write('upstream.rs', lines(['// unrelated']));
  return await repo.commit('upstream file');
}

async function amendFeature(repo: TestRepository, content: string): Promise<CommitSha> {
  repo.write('feature.rs', content);
  await repo.git('commit', '--quiet', '--amend', '--no-edit', '--all');
  return (await repo.git('rev-parse', 'HEAD')) as CommitSha;
}
