import { describe } from 'vitest';

import type { FileLineMapping, LineMappingHunk } from './line-mapping.ts';
import { reanchorUraAnchor } from './reanchor-ura-anchor.ts';
import type { ReanchoredAnchor } from './reanchor-ura-anchor.ts';
import type { UraAnchor } from './ura-item.ts';
import { test } from './testing/test.ts';

function lines(startLine: number, endLine: number, path = 'src/a.ts'): UraAnchor {
  return { kind: 'lines', path, startLine, endLine };
}

function current(startLine: number, endLine: number, path = 'src/a.ts'): ReanchoredAnchor {
  return { kind: 'current', anchor: lines(startLine, endLine, path) };
}

/** A zero-context hunk: `removed` lines after old line `before` replaced by `added` lines. */
function change(before: number, removed: number, added: number): LineMappingHunk {
  return {
    oldStart: removed === 0 ? before : before + 1,
    oldCount: removed,
    newStart: 0,
    newCount: added,
  };
}

/** Re-anchors `anchor` across hunks in its own file, `src/a.ts`. */
function across(anchor: UraAnchor, ...hunks: LineMappingHunk[]): ReanchoredAnchor {
  return reanchorUraAnchor(anchor, [{ kind: 'modified', path: 'src/a.ts', hunks }]);
}

describe('reanchorUraAnchor', () => {
  test('keeps an anchor whose file did not change', ({ expect }) => {
    expect(reanchorUraAnchor(lines(10, 12), [])).toStrictEqual(current(10, 12));
    const other: FileLineMapping[] = [
      { kind: 'modified', path: 'src/b.ts', hunks: [change(0, 5, 0)] },
    ];
    expect(reanchorUraAnchor(lines(10, 12), other)).toStrictEqual(current(10, 12));
  });

  test('keeps an anchor when only later lines changed', ({ expect }) => {
    expect(across(lines(10, 12), change(12, 1, 3), change(20, 1, 3))).toStrictEqual(
      current(10, 12),
    );
  });

  test('shifts by insertions and deletions above the range', ({ expect }) => {
    expect(across(lines(10, 12), change(2, 0, 3))).toStrictEqual(current(13, 15));
    expect(across(lines(10, 12), change(2, 4, 0))).toStrictEqual(current(6, 8));
    expect(across(lines(10, 12), change(1, 2, 5), change(5, 1, 0))).toStrictEqual(current(12, 14));
  });

  test('shifts when an edit ends on the line right above the range', ({ expect }) => {
    expect(across(lines(10, 12), change(7, 2, 1))).toStrictEqual(current(9, 11));
  });

  test('only moves for insertions directly before or after the range', ({ expect }) => {
    expect(across(lines(10, 12), change(9, 0, 2))).toStrictEqual(current(12, 14));
    expect(across(lines(10, 12), change(12, 0, 2))).toStrictEqual(current(10, 12));
  });

  test.for<[string, LineMappingHunk]>([
    ['the first line replaced', change(9, 1, 1)],
    ['a middle line deleted', change(10, 1, 0)],
    ['the last line replaced', change(11, 1, 1)],
    ['the whole range rewritten', change(5, 10, 2)],
    ['an edit straddling the start', change(8, 2, 2)],
    ['an edit straddling the end', change(11, 3, 0)],
    ['lines inserted after the first line', change(10, 0, 1)],
    ['lines inserted after the second line', change(11, 0, 4)],
  ])('is outdated with %s', ([, hunk], { expect }) => {
    expect(across(lines(10, 12), hunk)).toStrictEqual(outdated());
  });

  test('is outdated by the first touching hunk even after shifting ones', ({ expect }) => {
    expect(across(lines(10, 12), change(1, 0, 5), change(10, 1, 1))).toStrictEqual(outdated());
  });

  test('never outdates a single line by insertion', ({ expect }) => {
    expect(across(lines(10, 10), change(9, 0, 1))).toStrictEqual(current(11, 11));
    expect(across(lines(10, 10), change(10, 0, 1))).toStrictEqual(current(10, 10));
  });

  test('ignores context lines inside hunks', ({ expect }) => {
    // Old lines 7–13 with one line inserted after line 8; the anchor 10–12 is all context.
    const hunk: LineMappingHunk = {
      oldStart: 7,
      oldCount: 7,
      newStart: 7,
      newCount: 8,
      lines: [
        { kind: 'context' },
        { kind: 'context' },
        { kind: 'added' },
        { kind: 'context' },
        { kind: 'context' },
        { kind: 'context' },
        { kind: 'context' },
        { kind: 'context' },
      ],
    };
    expect(across(lines(10, 12), hunk)).toStrictEqual(current(11, 13));
    // Without its lines the same hunk is one changed block over the anchor.
    const bare: LineMappingHunk = { oldStart: 7, oldCount: 7, newStart: 7, newCount: 8 };
    expect(across(lines(10, 12), bare)).toStrictEqual(outdated());
  });

  test('accepts hunks with context exactly as git prints them', ({ expect }) => {
    // @@ -6,7 +6,6 @@ with old line 9 removed: lines 10–12 move up by one.
    const hunk: LineMappingHunk = {
      oldStart: 6,
      oldCount: 7,
      newStart: 6,
      newCount: 6,
      lines: [
        { kind: 'context' },
        { kind: 'context' },
        { kind: 'context' },
        { kind: 'removed' },
        { kind: 'context' },
        { kind: 'context' },
        { kind: 'context' },
      ],
    };
    expect(across(lines(10, 12), hunk)).toStrictEqual(current(9, 11));
  });

  test('follows renames, with or without edits', ({ expect }) => {
    const renamed: FileLineMapping[] = [
      { kind: 'renamed', oldPath: 'src/a.ts', newPath: 'src/b.ts', hunks: [change(0, 0, 1)] },
    ];
    expect(reanchorUraAnchor(lines(10, 12), renamed)).toStrictEqual(current(11, 13, 'src/b.ts'));
    expect(reanchorUraAnchor({ kind: 'file', path: 'src/a.ts' }, renamed)).toStrictEqual({
      kind: 'current',
      anchor: { kind: 'file', path: 'src/b.ts' },
    });
  });

  test('does not mistake a file renamed onto the anchored path for the anchored file', ({
    expect,
  }) => {
    const files: FileLineMapping[] = [
      { kind: 'renamed', oldPath: 'src/z.ts', newPath: 'src/a.ts', hunks: [change(0, 0, 9)] },
    ];
    expect(reanchorUraAnchor(lines(10, 12), files)).toStrictEqual(current(10, 12));
  });

  test('is outdated when the file was deleted', ({ expect }) => {
    const deleted: FileLineMapping[] = [{ kind: 'deleted', path: 'src/a.ts' }];
    const gone: ReanchoredAnchor = { kind: 'outdated', reason: 'file-deleted' };
    expect(reanchorUraAnchor(lines(1, 1), deleted)).toStrictEqual(gone);
    expect(reanchorUraAnchor({ kind: 'file', path: 'src/a.ts' }, deleted)).toStrictEqual(gone);
  });

  test('keeps whole-file anchors through edits, and whole-change anchors always', ({ expect }) => {
    const file: UraAnchor = { kind: 'file', path: 'src/a.ts' };
    expect(across(file, change(0, 50, 1))).toStrictEqual({ kind: 'current', anchor: file });
    const deleted: FileLineMapping[] = [{ kind: 'deleted', path: 'src/a.ts' }];
    expect(reanchorUraAnchor({ kind: 'change' }, deleted)).toStrictEqual({
      kind: 'current',
      anchor: { kind: 'change' },
    });
  });
});

function outdated(): ReanchoredAnchor {
  return { kind: 'outdated', reason: 'lines-changed' };
}
