import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import type { CommitSha } from './object-id.ts';
import { pairCommits } from './pair-commits.ts';
import type { PairableCommit } from './pair-commits.ts';
import { parseUnifiedDiff } from './parse-unified-diff.ts';
import { test } from './testing/test.ts';

describe('pairCommits', () => {
  test('pairs equal patch-ids first, in order, even when reordered', ({ expect }) => {
    const previous = [
      commit({ sha: 'a', subject: 'one', changes: ['+x'], patchId: 'p1' }),
      commit({ sha: 'b', subject: 'two', changes: ['+y'], patchId: 'p2' }),
    ];
    const next = [
      commit({ sha: 'c', subject: 'two', changes: ['+y'], patchId: 'p2' }),
      commit({ sha: 'd', subject: 'one', changes: ['+x'], patchId: 'p1' }),
    ];
    expect(describePairs(pairCommits(previous, next))).toStrictEqual(['b=c', 'a=d']);
  });

  test('pairs duplicated patches positionally', ({ expect }) => {
    const previous = [
      commit({ sha: 'a', subject: 'x', changes: ['+1'], patchId: 'p' }),
      commit({ sha: 'b', subject: 'x', changes: ['+1'], patchId: 'p' }),
    ];
    const next = [
      commit({ sha: 'c', subject: 'x', changes: ['+1'], patchId: 'p' }),
      commit({ sha: 'd', subject: 'x', changes: ['+1'], patchId: 'p' }),
    ];
    expect(describePairs(pairCommits(previous, next))).toStrictEqual(['a=c', 'b=d']);
  });

  test('matches an amended commit by changed-line overlap and reports added and dropped ones', ({
    expect,
  }) => {
    const previous = [
      commit({
        sha: 'a',
        subject: 'parse input',
        changes: ['+line 1', '+line 2', '+line 3', '+line 4'],
      }),
      commit({ sha: 'b', subject: 'add cache', changes: ['+cache 1', '+cache 2'] }),
    ];
    const next = [
      commit({
        sha: 'c',
        subject: 'parse input, handle errors',
        changes: ['+line 1', '+line 2', '+line 3', '+line 5'],
      }),
      commit({ sha: 'd', subject: 'docs', changes: ['+readme'] }),
    ];
    const pairs = pairCommits(previous, next);
    expect(describePairs(pairs)).toStrictEqual(['a~c', '-b', '+d']);
    expect(pairs[0]).toMatchObject({ kind: 'modified', similarity: 0.75 });
  });

  test('accepts a lower overlap when the subject is unchanged, but not for unrelated commits', ({
    expect,
  }) => {
    const previous = [
      commit({ sha: 'a', subject: 'fix login', changes: ['+a', '+b', '+c', '+d', '+e'] }),
    ];
    const rewritten = [
      commit({ sha: 'b', subject: 'fix login', changes: ['+a', '+v', '+w', '+x', '+y'] }),
    ];
    expect(describePairs(pairCommits(previous, rewritten))).toStrictEqual(['a~b']);
    const renamed = [
      commit({ sha: 'b', subject: 'fix sign-in', changes: ['+a', '+v', '+w', '+x', '+y'] }),
    ];
    expect(describePairs(pairCommits(previous, renamed))).toStrictEqual(['-a', '+b']);
  });

  test('places dropped commits before the next pair that follows them', ({ expect }) => {
    const previous = [
      commit({ sha: 'a', subject: 'one', changes: ['+1'], patchId: 'p1' }),
      commit({ sha: 'b', subject: 'two', changes: ['+2'], patchId: 'p2' }),
      commit({ sha: 'c', subject: 'three', changes: ['+3'], patchId: 'p3' }),
    ];
    const next = [
      commit({ sha: 'd', subject: 'one', changes: ['+1'], patchId: 'p1' }),
      commit({ sha: 'e', subject: 'three', changes: ['+3'], patchId: 'p3' }),
    ];
    expect(describePairs(pairCommits(previous, next))).toStrictEqual(['a=d', '-b', 'c=e']);
  });

  test('pairs empty commits by subject', ({ expect }) => {
    const previous = [commit({ sha: 'a', subject: 'bump', changes: [] })];
    const same = [commit({ sha: 'b', subject: 'bump', changes: [] })];
    const other = [commit({ sha: 'b', subject: 'other', changes: [] })];
    expect(describePairs(pairCommits(previous, same))).toStrictEqual(['a=b']);
    expect(describePairs(pairCommits(previous, other))).toStrictEqual(['-a', '+b']);
  });
});

/** `=` unchanged, `~` modified, `+` added, `-` dropped. */
function describePairs(pairs: ReturnType<typeof pairCommits<PairableCommit>>): string[] {
  return pairs.map((pair) => {
    switch (pair.kind) {
      case 'unchanged': {
        return `${pair.previous.sha}=${pair.next.sha}`;
      }
      case 'modified': {
        return `${pair.previous.sha}~${pair.next.sha}`;
      }
      case 'added': {
        return `+${pair.next.sha}`;
      }
      case 'dropped': {
        return `-${pair.previous.sha}`;
      }
    }
  });
}

/** A commit to pair: its id, subject, the `+`/`-` lines it changes and its patch id. */
interface TestCommit {
  readonly sha: string;
  readonly subject: string;
  readonly changes: readonly string[];
  readonly patchId?: string;
}

function commit({ sha, subject, changes, patchId = `id-${sha}` }: TestCommit): PairableCommit {
  const added = changes.filter((line) => line.startsWith('+')).length;
  const removed = changes.length - added;
  const text = [
    'diff --git a/f.txt b/f.txt',
    'index 1111111111111111111111111111111111111111..2222222222222222222222222222222222222222 100644',
    '--- a/f.txt',
    '+++ b/f.txt',
    `@@ -1,${String(removed)} +1,${String(added)} @@`,
    ...changes,
    '',
  ].join('\n');
  if (changes.length === 0) {
    return { sha: sha as CommitSha, subject, patchId: undefined, files: [] };
  }
  return {
    sha: sha as CommitSha,
    subject,
    patchId,
    files: okValueFrom(parseUnifiedDiff(text)),
  };
}
