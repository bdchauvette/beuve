import { describe } from 'vitest';

import type { DiffHunk, DiffLine } from '#internal/git/diff-model.ts';
import { test } from '#testing/test.ts';

import { sheetMarksFrom } from './sheet-marks-from.ts';

function hunk(
  { newStart, newCount }: Pick<DiffHunk, 'newStart' | 'newCount'>,
  lines: readonly DiffLine[],
): DiffHunk {
  return { oldStart: 1, oldCount: 1, newStart, newCount, header: '@@', section: '', lines };
}

function context(newLine: number): DiffLine {
  return { kind: 'context', content: '', oldLine: newLine, newLine, noNewline: false };
}

function added(newLine: number): DiffLine {
  return { kind: 'added', content: '', newLine, noNewline: false };
}

function removed(oldLine: number): DiffLine {
  return { kind: 'removed', content: '', oldLine, noNewline: false };
}

describe('sheetMarksFrom', () => {
  test('tells added, modified and removed runs apart', ({ expect }) => {
    const marks = sheetMarksFrom(
      [
        hunk({ newStart: 1, newCount: 6 }, [
          context(1),
          added(2),
          added(3),
          context(4),
          removed(4),
          added(5),
          context(6),
          removed(6),
          removed(7),
          context(7),
        ]),
      ],
      20,
    );
    expect(marks).toStrictEqual({
      added: [{ startLine: 2, endLine: 3 }],
      modified: [{ startLine: 5, endLine: 5 }],
      deletedAt: [7],
    });
  });

  test('marks a removal at the end on the last line, and one in an empty hunk below its start', ({
    expect,
  }) => {
    const atEnd = [hunk({ newStart: 9, newCount: 1 }, [context(9), removed(10)])];
    const empty = [hunk({ newStart: 3, newCount: 0 }, [removed(4)])];
    expect(sheetMarksFrom(atEnd, 9).deletedAt).toStrictEqual([9]);
    expect(sheetMarksFrom(empty, 9).deletedAt).toStrictEqual([4]);
    expect(sheetMarksFrom([], 9)).toStrictEqual({ added: [], modified: [], deletedAt: [] });
  });
});
