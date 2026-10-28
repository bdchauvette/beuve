import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { computeInterdiff } from './compute-interdiff.ts';
import { createTestRepository } from './testing/create-test-repository.ts';
import type { TestRepository } from './testing/create-test-repository.ts';
import type { DiffFile } from './diff-model.ts';
import { diffObjects } from './diff-objects.ts';
import type { CommitSha } from './object-id.ts';
import { openRepository } from './open-repository.ts';
import type { GitRepository } from './open-repository.ts';
import type { ReviewRange } from './review-range.ts';

const appLines = ['fn main() {', '  setup();', '  run();', '  teardown();', '}'];

describe('computeInterdiff', () => {
  let repo: TestRepository;
  let git: GitRepository;
  beforeEach(async () => {
    repo = createTestRepository();
    const opened = await openRepository(repo.directory);
    if (!opened.ok) {
      throw new Error(opened.error.kind);
    }
    git = opened.value;
  });
  afterEach(() => {
    repo.cleanup();
  });

  /** main: app + lib; topic: edits app, adds feature. Returns the reviewed range. */
  const reviewedBranch = (): ReviewRange => {
    repo.write('app.rs', lines(appLines));
    repo.write('lib.rs', lines(['pub fn lib() {}']));
    const base = repo.commit('base');
    repo.git('switch', '--quiet', '--create', 'topic');
    repo.write('app.rs', lines(appLines.with(2, '  run_fast();')));
    repo.commit('speed up');
    repo.write('feature.rs', lines(['pub fn feature() -> u8 {', '  1', '}']));
    const head = repo.commit('add feature');
    return { base, head };
  };

  const upstreamAdvances = (): CommitSha => {
    repo.git('switch', '--quiet', 'main');
    repo.write('lib.rs', lines(['pub fn lib() {}', 'pub fn more() {}']));
    repo.commit('upstream lib');
    repo.write('upstream.rs', lines(['// unrelated']));
    return repo.commit('upstream file');
  };

  const amendFeature = (content: string): CommitSha => {
    repo.write('feature.rs', content);
    repo.git('commit', '--quiet', '--amend', '--no-edit', '--all');
    return repo.git('rev-parse', 'HEAD') as CommitSha;
  };

  it('diffs heads directly when the fork point is unchanged', async () => {
    const previous = reviewedBranch();
    repo.write('feature.rs', lines(['pub fn feature() -> u8 {', '  2', '}']));
    const head = repo.commit('fixup');
    const result = await computeInterdiff(git, previous, { base: previous.base, head });
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'exact', nextMergeBase: previous.base },
    });
    expect(summary(result.ok ? result.value.files : [])).toEqual([
      ['feature.rs', ['-  1', '+  2']],
    ]);

    await expect(computeInterdiff(git, previous, previous)).resolves.toMatchObject({
      ok: true,
      value: { kind: 'exact', files: [] },
    });
  });

  it('shows only the amendment after a rebase onto an advanced base', async () => {
    const previous = reviewedBranch();
    const newBase = upstreamAdvances();
    repo.git('switch', '--quiet', 'topic');
    repo.git('rebase', '--quiet', 'main');
    const head = amendFeature(lines(['pub fn feature() -> u8 {', '  42', '}']));
    const next = { base: newBase, head };

    const result = await computeInterdiff(git, previous, next);
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'rebased', previousMergeBase: previous.base, nextMergeBase: newBase },
    });
    expect(summary(result.ok ? result.value.files : [])).toEqual([
      ['feature.rs', ['-  1', '+  42']],
    ]);

    const naive = await diffObjects(git, previous.head, head);
    expect(summary(naive.ok ? naive.value : []).map(([path]) => path)).toEqual([
      'feature.rs',
      'lib.rs',
      'upstream.rs',
    ]);
  });

  it('reports no changes for a pure rebase', async () => {
    const previous = reviewedBranch();
    const newBase = upstreamAdvances();
    repo.git('switch', '--quiet', 'topic');
    repo.git('rebase', '--quiet', 'main');
    const head = repo.git('rev-parse', 'HEAD') as CommitSha;
    await expect(computeInterdiff(git, previous, { base: newBase, head })).resolves.toMatchObject({
      ok: true,
      value: { kind: 'rebased', files: [] },
    });
  });

  it('works on git 2.38–2.39 when the old fork point is an ancestor of the new one', async () => {
    const previous = reviewedBranch();
    const newBase = upstreamAdvances();
    repo.git('switch', '--quiet', 'topic');
    repo.git('rebase', '--quiet', 'main');
    const head = amendFeature(lines(['pub fn feature() -> u8 {', '  42', '}']));
    const older = { ...git, version: { major: 2, minor: 39, patch: 3, raw: 'git version 2.39.3' } };
    const result = await computeInterdiff(older, previous, { base: newBase, head });
    expect(result).toMatchObject({ ok: true, value: { kind: 'rebased' } });
    expect(summary(result.ok ? result.value.files : [])).toEqual([
      ['feature.rs', ['-  1', '+  42']],
    ]);
  });

  it('falls back to the full new range when replaying the reviewed changes conflicts', async () => {
    const previous = reviewedBranch();
    repo.git('switch', '--quiet', 'main');
    repo.write('app.rs', lines(appLines.with(2, '  run_upstream();')));
    const newBase = repo.commit('upstream touches the same line');
    repo.git('switch', '--quiet', 'topic');
    repo.git('rebase', '--quiet', '--strategy-option=theirs', 'main');
    const head = repo.git('rev-parse', 'HEAD') as CommitSha;

    const result = await computeInterdiff(git, previous, { base: newBase, head });
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'fallback', reason: { kind: 'conflicts', paths: ['app.rs'] } },
    });
    expect(summary(result.ok ? result.value.files : []).map(([path]) => path)).toEqual([
      'app.rs',
      'feature.rs',
    ]);
  });

  it('falls back when git is too old to synthesize the replay', async () => {
    const previous = reviewedBranch();
    const newBase = upstreamAdvances();
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
