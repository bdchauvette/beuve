import { describe, expect, it } from 'vitest';

import { parseSuggestedPatch } from './parse-suggested-patch.ts';
import type { UraAnchor } from './ura-item.ts';

const anchor: UraAnchor = { kind: 'lines', path: 'src/a.ts', startLine: 10, endLine: 12 };
const hunk = ['@@ -10,3 +10,3 @@', ' one', '-two', '+TWO', ' three'];

function patch(...lines: string[]): string {
  return `${lines.join('\n')}\n`;
}

function reason(text: string, target: UraAnchor = anchor): string | undefined {
  const result = parseSuggestedPatch(text, target);
  return result.ok ? undefined : result.error.reason;
}

describe('parseSuggestedPatch', () => {
  it('adds headers to bare hunks and parses them', () => {
    const result = parseSuggestedPatch(patch(...hunk), anchor);
    expect(result).toEqual({
      ok: true,
      value: {
        path: 'src/a.ts',
        text: patch('--- a/src/a.ts', '+++ b/src/a.ts', ...hunk),
        hunks: [
          {
            oldStart: 10,
            oldCount: 3,
            newStart: 10,
            newCount: 3,
            lines: [
              { kind: 'context', content: 'one' },
              { kind: 'removed', content: 'two' },
              { kind: 'added', content: 'TWO' },
              { kind: 'context', content: 'three' },
            ],
          },
        ],
      },
    });
  });

  it('accepts git headers for the anchored path and normalizes them', () => {
    const text = patch(
      'diff --git a/src/a.ts b/src/a.ts',
      'index 1234567..89abcde 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      ...hunk,
    );
    const result = parseSuggestedPatch(text, anchor);
    expect(result.ok && result.value.text).toBe(patch('--- a/src/a.ts', '+++ b/src/a.ts', ...hunk));
    expect(parseSuggestedPatch(patch('--- src/a.ts', '+++ src/a.ts', ...hunk), anchor).ok).toBe(
      true,
    );
  });

  it('round-trips its own normalized text', () => {
    const first = parseSuggestedPatch(patch(...hunk), anchor);
    const second = first.ok ? parseSuggestedPatch(first.value.text, anchor) : first;
    expect(second).toEqual(first);
  });

  it('accepts a missing trailing newline, stripped empty context lines and no-newline markers', () => {
    const text = [
      '@@ -10,3 +10,3 @@',
      ' one',
      '',
      '-three',
      '\\ No newline at end of file',
      '+3',
      '\\ No newline at end of file',
    ].join('\n');
    const result = parseSuggestedPatch(text, anchor);
    expect(result.ok && result.value.hunks[0]?.lines).toEqual([
      { kind: 'context', content: 'one' },
      { kind: 'context', content: '' },
      { kind: 'removed', content: 'three' },
      { kind: 'added', content: '3' },
    ]);
  });

  it('reads a bare count as one line and -a,0 as an insertion', () => {
    expect(reason(patch('@@ -11 +11 @@', '-x', '+y'))).toBeUndefined();
    expect(reason(patch('@@ -12,0 +13,1 @@', '+after the last line'))).toBeUndefined();
    expect(reason(patch('@@ -9,0 +10,1 @@', '+before the first line'))).toBeUndefined();
  });

  it('refuses other files, several files and whole-change anchors', () => {
    expect(reason(patch('--- a/src/b.ts', '+++ b/src/b.ts', ...hunk))).toBe(
      'the patch must change only src/a.ts',
    );
    expect(reason(patch('--- /dev/null', '+++ b/src/a.ts', ...hunk))).toBe(
      'the patch must change only src/a.ts',
    );
    expect(reason(patch(...hunk, '--- a/src/b.ts', '+++ b/src/b.ts', ...hunk))).toBe(
      'the patch must change only one file',
    );
    expect(reason(patch(...hunk), { kind: 'change' })).toBe('a patch needs a file or line anchor');
  });

  it('refuses changes outside the anchored lines, but allows context around them', () => {
    expect(reason(patch('@@ -9,3 +9,3 @@', '-zero', '+ZERO', ' one', ' two'))).toBe(
      'the patch changes lines outside 10–12',
    );
    expect(reason(patch('@@ -12,2 +12,2 @@', ' three', '-four', '+FOUR'))).toBe(
      'the patch changes lines outside 10–12',
    );
    expect(reason(patch('@@ -13,0 +14,1 @@', '+too far'))).toBe(
      'the patch changes lines outside 10–12',
    );
    expect(
      reason(
        patch('@@ -7,8 +7,8 @@', ' a', ' b', ' c', ' one', '-two', '+TWO', ' three', ' d', ' e'),
      ),
    ).toBeUndefined();
  });

  it('allows changes anywhere in the file for a file anchor', () => {
    expect(
      reason(patch('@@ -1,1 +1,1 @@', '-a', '+b'), { kind: 'file', path: 'src/a.ts' }),
    ).toBeUndefined();
  });

  it('refuses malformed hunks', () => {
    expect(reason('')).toBe('the patch has no hunks');
    expect(reason(patch('--- a/src/a.ts', '+++ b/src/a.ts'))).toBe('the patch has no hunks');
    expect(reason(patch('hello'))).toBe('line 1 is not a hunk header');
    expect(reason(patch('@@ -10,x +10 @@', ' one'))).toBe('line 1 is not a hunk header');
    expect(reason(patch('@@ -10,3 +10,3 @@', ' one', '-two'))).toBe(
      'the hunk at line 1 is shorter than its header says',
    );
    expect(reason(patch('@@ -10,1 +10,1 @@', '-two', '-three', '+x'))).toBe(
      'the hunk at line 1 is longer than its header says',
    );
    expect(reason(patch('@@ -10,1 +10,1 @@', '*two', '+x'))).toBe(
      'line 2 is not a context, added or removed line',
    );
    expect(reason(patch('--- a/src/a.ts', 'oops'))).toBe(
      'a "--- " header must be followed by "+++ "',
    );
    expect(reason(patch('diff --git a/src/a.ts b/src/a.ts', '@@ -10 +10 @@', '-x', '+y'))).toBe(
      'expected a "--- " header after the preamble',
    );
  });

  it('refuses hunks out of order, overlapping or changing nothing', () => {
    expect(reason(patch('@@ -12 +12 @@', '-c', '+C', '@@ -10 +10 @@', '-a', '+A'))).toBe(
      'hunks must be in order and must not overlap',
    );
    expect(
      reason(patch('@@ -10,2 +10,2 @@', '-a', '-b', '+A', '+B', '@@ -11 +11 @@', '-b', '+B')),
    ).toBe('hunks must be in order and must not overlap');
    expect(reason(patch('@@ -10,2 +10,2 @@', ' a', ' b'))).toBe('the patch changes nothing');
  });
});
