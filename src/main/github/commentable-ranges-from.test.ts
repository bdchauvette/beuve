import { describe } from 'vitest';

import type { DiffFile, DiffHunk, FileChange } from '#internal/git/diff-model.ts';

import { commentableRangesFrom } from './commentable-ranges-from.ts';
import { test } from '../testing/test.ts';

describe('commentableRangesFrom', () => {
  test('spans each hunk on the head side, under the new path, skipping deletions', ({ expect }) => {
    const files: DiffFile[] = [
      file({ status: 'modified', path: 'a.ts', oldMode: '100644', newMode: '100644' }, [
        hunk({ newStart: 1, newCount: 3 }),
        hunk({ newStart: 10, newCount: 0 }),
        hunk({ newStart: 20, newCount: 2 }),
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
        [hunk({ newStart: 5, newCount: 1 })],
      ),
      file({ status: 'deleted', path: 'gone.ts', mode: '100644' }, [
        hunk({ newStart: 0, newCount: 0 }),
      ]),
    ];
    expect(commentableRangesFrom(files)).toStrictEqual(
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

function hunk({ newStart, newCount }: Pick<DiffHunk, 'newStart' | 'newCount'>): DiffHunk {
  return { oldStart: 1, oldCount: 1, newStart, newCount, header: '@@', section: '', lines: [] };
}
