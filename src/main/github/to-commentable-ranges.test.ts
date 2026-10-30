import { describe } from 'vitest';

import type { DiffFile, DiffHunk, FileChange } from '#internal/git/diff-model.ts';

import { toCommentableRanges } from './to-commentable-ranges.ts';
import { test } from '../testing/test.ts';

describe('toCommentableRanges', () => {
  test('spans each hunk on the head side, under the new path, skipping deletions', ({ expect }) => {
    const files: DiffFile[] = [
      file({ status: 'modified', path: 'a.ts', oldMode: '100644', newMode: '100644' }, [
        hunk(1, 3),
        hunk(10, 0),
        hunk(20, 2),
      ]),
      file(
        {
          status: 'renamed',
          oldPath: 'old.ts',
          newPath: 'new.ts',
          similarity: 90,
          oldMode: '100644',
          newMode: '100644',
        },
        [hunk(5, 1)],
      ),
      file({ status: 'deleted', path: 'gone.ts', mode: '100644' }, [hunk(0, 0)]),
    ];
    expect(toCommentableRanges(files)).toStrictEqual(
      new Map([
        [
          'a.ts',
          [
            { start: 1, end: 3 },
            { start: 20, end: 21 },
          ],
        ],
        ['new.ts', [{ start: 5, end: 5 }]],
      ]),
    );
  });
});

function file(change: FileChange, hunks: DiffHunk[]): DiffFile {
  return {
    ...change,
    binary: false,
    submodule: false,
    oldObject: undefined,
    newObject: undefined,
    hunks,
    patch: '',
  };
}

function hunk(newStart: number, newCount: number): DiffHunk {
  return { oldStart: 1, oldCount: 1, newStart, newCount, header: '@@', section: '', lines: [] };
}
