import { describe } from 'vitest';

import type { ChangeRegion } from './change-regions-from.ts';
import type { FileLineMapping, LineMappingHunk } from './line-mapping.ts';
import { reanchorUraAnchor } from './reanchor-ura-anchor.ts';
import type { ReanchoredAnchor } from './reanchor-ura-anchor.ts';
import type { UraAnchor } from './ura-item.ts';
import { test } from './testing/test.ts';

function lines(start: number, end: number): Extract<UraAnchor, { kind: 'lines' }> {
  return { kind: 'lines', path: 'src/a.ts', startLine: start, endLine: end };
}

function current(start: number, end: number): ReanchoredAnchor {
  return { kind: 'current', anchor: lines(start, end) };
}

/** A zero-context hunk: `removed` lines after old line `before` replaced by `added` lines. */
function change({ before, removed, added }: ChangeRegion): LineMappingHunk {
  let oldStart = before;
  if (removed > 0) {
    oldStart += 1;
  }
  return {
    oldStart,
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
      { kind: 'modified', path: 'src/b.ts', hunks: [change({ before: 0, removed: 5, added: 0 })] },
    ];
    expect(reanchorUraAnchor(lines(10, 12), other)).toStrictEqual(current(10, 12));
  });

  test('keeps an anchor when only later lines changed', ({ expect }) => {
    expect(
      across(
        lines(10, 12),
        change({ before: 12, removed: 1, added: 3 }),
        change({ before: 20, removed: 1, added: 3 }),
      ),
    ).toStrictEqual(current(10, 12));
  });

  test('shifts by insertions and deletions above the range', ({ expect }) => {
    expect(across(lines(10, 12), change({ before: 2, removed: 0, added: 3 }))).toStrictEqual(
      current(13, 15),
    );
    expect(across(lines(10, 12), change({ before: 2, removed: 4, added: 0 }))).toStrictEqual(
      current(6, 8),
    );
    expect(
      across(
        lines(10, 12),
        change({ before: 1, removed: 2, added: 5 }),
        change({ before: 5, removed: 1, added: 0 }),
      ),
    ).toStrictEqual(current(12, 14));
  });

  test('shifts when an edit ends on the line right above the range', ({ expect }) => {
    expect(across(lines(10, 12), change({ before: 7, removed: 2, added: 1 }))).toStrictEqual(
      current(9, 11),
    );
  });

  test('only moves for insertions directly before or after the range', ({ expect }) => {
    expect(across(lines(10, 12), change({ before: 9, removed: 0, added: 2 }))).toStrictEqual(
      current(12, 14),
    );
    expect(across(lines(10, 12), change({ before: 12, removed: 0, added: 2 }))).toStrictEqual(
      current(10, 12),
    );
  });

  test.for<[string, LineMappingHunk]>([
    ['the first line replaced', change({ before: 9, removed: 1, added: 1 })],
    ['a middle line deleted', change({ before: 10, removed: 1, added: 0 })],
    ['the last line replaced', change({ before: 11, removed: 1, added: 1 })],
    ['the whole range rewritten', change({ before: 5, removed: 10, added: 2 })],
    ['an edit straddling the start', change({ before: 8, removed: 2, added: 2 })],
    ['an edit straddling the end', change({ before: 11, removed: 3, added: 0 })],
    ['lines inserted after the first line', change({ before: 10, removed: 0, added: 1 })],
    ['lines inserted after the second line', change({ before: 11, removed: 0, added: 4 })],
  ])('is outdated with %s', ([, hunk], { expect }) => {
    expect(across(lines(10, 12), hunk)).toStrictEqual(outdated());
  });

  test('is outdated by the first touching hunk even after shifting ones', ({ expect }) => {
    expect(
      across(
        lines(10, 12),
        change({ before: 1, removed: 0, added: 5 }),
        change({ before: 10, removed: 1, added: 1 }),
      ),
    ).toStrictEqual(outdated());
  });

  test('never outdates a single line by insertion', ({ expect }) => {
    expect(across(lines(10, 10), change({ before: 9, removed: 0, added: 1 }))).toStrictEqual(
      current(11, 11),
    );
    expect(across(lines(10, 10), change({ before: 10, removed: 0, added: 1 }))).toStrictEqual(
      current(10, 10),
    );
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
      {
        kind: 'renamed',
        oldPath: 'src/a.ts',
        newPath: 'src/b.ts',
        hunks: [change({ before: 0, removed: 0, added: 1 })],
      },
    ];
    expect(reanchorUraAnchor(lines(10, 12), renamed)).toStrictEqual({
      kind: 'current',
      anchor: { ...lines(11, 13), path: 'src/b.ts' },
    });
    expect(reanchorUraAnchor({ kind: 'file', path: 'src/a.ts' }, renamed)).toStrictEqual({
      kind: 'current',
      anchor: { kind: 'file', path: 'src/b.ts' },
    });
  });

  test('does not mistake a file renamed onto the anchored path for the anchored file', ({
    expect,
  }) => {
    const files: FileLineMapping[] = [
      {
        kind: 'renamed',
        oldPath: 'src/z.ts',
        newPath: 'src/a.ts',
        hunks: [change({ before: 0, removed: 0, added: 9 })],
      },
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
    expect(across(file, change({ before: 0, removed: 50, added: 1 }))).toStrictEqual({
      kind: 'current',
      anchor: file,
    });
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
