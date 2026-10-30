import { describe, expect, it } from 'vitest';

import type { CommitSha } from './object-id.ts';
import { pairCommits } from './pair-commits.ts';
import type { PairableCommit } from './pair-commits.ts';
import { parseUnifiedDiff } from './parse-unified-diff.ts';

describe('pairCommits', () => {
  it('pairs equal patch-ids first, in order, even when reordered', () => {
    const previous = [commit('a', 'one', ['+x'], 'p1'), commit('b', 'two', ['+y'], 'p2')];
    const next = [commit('c', 'two', ['+y'], 'p2'), commit('d', 'one', ['+x'], 'p1')];
    expect(describePairs(pairCommits(previous, next))).toEqual(['b=c', 'a=d']);
  });

  it('pairs duplicated patches positionally', () => {
    const previous = [commit('a', 'x', ['+1'], 'p'), commit('b', 'x', ['+1'], 'p')];
    const next = [commit('c', 'x', ['+1'], 'p'), commit('d', 'x', ['+1'], 'p')];
    expect(describePairs(pairCommits(previous, next))).toEqual(['a=c', 'b=d']);
  });

  it('matches an amended commit by changed-line overlap and reports added and dropped ones', () => {
    const previous = [
      commit('a', 'parse input', ['+line 1', '+line 2', '+line 3', '+line 4']),
      commit('b', 'add cache', ['+cache 1', '+cache 2']),
    ];
    const next = [
      commit('c', 'parse input, handle errors', ['+line 1', '+line 2', '+line 3', '+line 5']),
      commit('d', 'docs', ['+readme']),
    ];
    const pairs = pairCommits(previous, next);
    expect(describePairs(pairs)).toEqual(['a~c', '-b', '+d']);
    expect(pairs[0]).toMatchObject({ kind: 'modified', similarity: 0.75 });
  });

  it('accepts a lower overlap when the subject is unchanged, but not for unrelated commits', () => {
    const previous = [commit('a', 'fix login', ['+a', '+b', '+c', '+d', '+e'])];
    const rewritten = [commit('b', 'fix login', ['+a', '+v', '+w', '+x', '+y'])];
    expect(describePairs(pairCommits(previous, rewritten))).toEqual(['a~b']);
    const renamed = [commit('b', 'fix sign-in', ['+a', '+v', '+w', '+x', '+y'])];
    expect(describePairs(pairCommits(previous, renamed))).toEqual(['-a', '+b']);
  });

  it('places dropped commits before the next pair that follows them', () => {
    const previous = [
      commit('a', 'one', ['+1'], 'p1'),
      commit('b', 'two', ['+2'], 'p2'),
      commit('c', 'three', ['+3'], 'p3'),
    ];
    const next = [commit('d', 'one', ['+1'], 'p1'), commit('e', 'three', ['+3'], 'p3')];
    expect(describePairs(pairCommits(previous, next))).toEqual(['a=d', '-b', 'c=e']);
  });

  it('pairs empty commits by subject', () => {
    const previous = [commit('a', 'bump', [])];
    const same = [commit('b', 'bump', [])];
    const other = [commit('b', 'other', [])];
    expect(describePairs(pairCommits(previous, same))).toEqual(['a=b']);
    expect(describePairs(pairCommits(previous, other))).toEqual(['-a', '+b']);
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

function commit(
  sha: string,
  subject: string,
  changes: readonly string[],
  patchId = `id-${sha}`,
): PairableCommit {
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
  const files = parseUnifiedDiff(changes.length === 0 ? '' : text);
  if (!files.ok) {
    throw new Error(files.error.message);
  }
  return {
    sha: sha as CommitSha,
    subject,
    patchId: changes.length === 0 ? undefined : patchId,
    files: files.value,
  };
}
