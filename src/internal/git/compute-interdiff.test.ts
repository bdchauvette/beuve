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
    const previous = reviewedBranch(repo);
    repo.write('feature.rs', lines(['pub fn feature() -> u8 {', '  2', '}']));
    const head = repo.commit('fixup');
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
    const previous = reviewedBranch(repo);
    const newBase = upstreamAdvances(repo);
    repo.git('switch', '--quiet', 'topic');
    repo.git('rebase', '--quiet', 'main');
    const head = amendFeature(repo, lines(['pub fn feature() -> u8 {', '  42', '}']));
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
    const previous = reviewedBranch(repo);
    const newBase = upstreamAdvances(repo);
    repo.git('switch', '--quiet', 'topic');
    repo.git('rebase', '--quiet', 'main');
    const head = repo.git('rev-parse', 'HEAD') as CommitSha;
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
    const previous = reviewedBranch(repo);
    const newBase = upstreamAdvances(repo);
    repo.git('switch', '--quiet', 'topic');
    repo.git('rebase', '--quiet', 'main');
    const head = amendFeature(repo, lines(['pub fn feature() -> u8 {', '  42', '}']));
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
    const previous = reviewedBranch(repo);
    repo.git('switch', '--quiet', 'main');
    repo.write('app.rs', lines(appLines().with(2, '  run_upstream();')));
    const newBase = repo.commit('upstream touches the same line');
    repo.git('switch', '--quiet', 'topic');
    repo.git('rebase', '--quiet', '--strategy-option=theirs', 'main');
    const head = repo.git('rev-parse', 'HEAD') as CommitSha;

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
    const previous = reviewedBranch(repo);
    const newBase = upstreamAdvances(repo);
    repo.git('switch', '--quiet', 'topic');
    repo.git('rebase', '--quiet', 'main');
    const head = repo.git('rev-parse', 'HEAD') as CommitSha;
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
  return files.map((file) => [
    'path' in file ? file.path : file.newPath,
    file.hunks.flatMap((hunk) =>
      hunk.lines
        .filter((line) => line.kind !== 'context')
        .map((line) => `${line.kind === 'added' ? '+' : '-'}${line.content}`),
    ),
  ]);
}

function appLines(): readonly string[] {
  return ['fn main() {', '  setup();', '  run();', '  teardown();', '}'];
}

/** main: app + lib; topic: edits app, adds feature. Returns the reviewed range. */
function reviewedBranch(repo: TestRepository): ReviewRange {
  repo.write('app.rs', lines(appLines()));
  repo.write('lib.rs', lines(['pub fn lib() {}']));
  const base = repo.commit('base');
  repo.git('switch', '--quiet', '--create', 'topic');
  repo.write('app.rs', lines(appLines().with(2, '  run_fast();')));
  repo.commit('speed up');
  repo.write('feature.rs', lines(['pub fn feature() -> u8 {', '  1', '}']));
  const head = repo.commit('add feature');
  return { base, head };
}

function upstreamAdvances(repo: TestRepository): CommitSha {
  repo.git('switch', '--quiet', 'main');
  repo.write('lib.rs', lines(['pub fn lib() {}', 'pub fn more() {}']));
  repo.commit('upstream lib');
  repo.write('upstream.rs', lines(['// unrelated']));
  return repo.commit('upstream file');
}

function amendFeature(repo: TestRepository, content: string): CommitSha {
  repo.write('feature.rs', content);
  repo.git('commit', '--quiet', '--amend', '--no-edit', '--all');
  return repo.git('rev-parse', 'HEAD') as CommitSha;
}
