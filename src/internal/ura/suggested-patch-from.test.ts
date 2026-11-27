import { describe } from 'vitest';

import { parseSuggestedPatch } from './parse-suggested-patch.ts';
import { suggestedPatchFrom } from './suggested-patch-from.ts';
import type { UraSuggestion } from './ura-item.ts';
import { test } from './testing/test.ts';

function suggestion(
  [startLine, endLine]: readonly [number, number],
  replacement: string,
): UraSuggestion {
  return { path: 'src/a.ts', startLine, endLine, replacement };
}

function patchOf(head: string, of: UraSuggestion): string | undefined {
  const result = suggestedPatchFrom(head, of);
  if (result.ok) {
    return result.value;
  }
  return undefined;
}

function diff(...lines: string[]): string {
  return ['--- a/src/a.ts', '+++ b/src/a.ts', ...lines, ''].join('\n');
}

/** Lines `1` to `9`, each newline-terminated. */
function nine(): string {
  return '1\n2\n3\n4\n5\n6\n7\n8\n9\n';
}

describe('suggestedPatchFrom', () => {
  test('replaces lines with three lines of context, trimming what stays the same', ({ expect }) => {
    expect(patchOf(nine(), suggestion([4, 6], '4\nfive\n6'))).toBe(
      diff('@@ -2,7 +2,7 @@', ' 2', ' 3', ' 4', '-5', '+five', ' 6', ' 7', ' 8'),
    );
    expect(patchOf(nine(), suggestion([1, 1], 'one'))).toBe(
      diff('@@ -1,4 +1,4 @@', '-1', '+one', ' 2', ' 3', ' 4'),
    );
  });

  test('inserts, deletes and inserts at either end', ({ expect }) => {
    expect(patchOf(nine(), suggestion([5, 4], 'new'))).toBe(
      diff('@@ -2,6 +2,7 @@', ' 2', ' 3', ' 4', '+new', ' 5', ' 6', ' 7'),
    );
    expect(patchOf(nine(), suggestion([8, 9], ''))).toBe(
      diff('@@ -5,5 +5,3 @@', ' 5', ' 6', ' 7', '-8', '-9'),
    );
    expect(patchOf(nine(), suggestion([10, 9], '10'))).toBe(
      diff('@@ -7,3 +7,4 @@', ' 7', ' 8', ' 9', '+10'),
    );
    expect(patchOf('', suggestion([1, 0], 'first'))).toBe(diff('@@ -0,0 +1,1 @@', '+first'));
  });

  test('keeps carriage returns and a missing final newline as git marks it', ({ expect }) => {
    const marker = '\\ No newline at end of file';
    expect(patchOf('a\r\nb\r\nc', suggestion([3, 3], 'C'))).toBe(
      diff('@@ -1,3 +1,3 @@', ' a\r', ' b\r', '-c', marker, '+C', marker),
    );
    expect(patchOf('a\nb\nc', suggestion([1, 1], 'A'))).toBe(
      diff('@@ -1,3 +1,3 @@', '-a', '+A', ' b', ' c', marker),
    );
    expect(patchOf('a\nb', suggestion([3, 2], 'c'))).toBe(
      diff('@@ -1,2 +1,3 @@', ' a', '-b', marker, '+b', '+c', marker),
    );
    expect(patchOf('a\nb', suggestion([2, 2], ''))).toBe(
      diff('@@ -1,2 +1,1 @@', '-a', '-b', marker, '+a', marker),
    );
  });

  test('derives a patch that parses as one hunk', ({ expect }) => {
    const text = patchOf(nine(), suggestion([3, 5], 'x\ny'));
    const parsed = parseSuggestedPatch(text ?? '', { kind: 'file', path: 'src/a.ts' });
    expect(parsed.ok && parsed.value.hunks).toHaveLength(1);
  });

  test('refuses lines past the end and a suggestion that changes nothing', ({ expect }) => {
    expect(suggestedPatchFrom(nine(), suggestion([10, 10], 'x'))).toStrictEqual({
      ok: false,
      error: { kind: 'out-of-range', lineCount: 9 },
    });
    expect(suggestedPatchFrom(nine(), suggestion([11, 10], 'x'))).toMatchObject({ ok: false });
    expect(suggestedPatchFrom(nine(), suggestion([2, 3], '2\n3'))).toStrictEqual({
      ok: false,
      error: { kind: 'unchanged' },
    });
  });
});
