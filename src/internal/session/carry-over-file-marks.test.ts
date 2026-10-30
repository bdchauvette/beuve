import { describe } from 'vitest';

import { carryOverFileMarks } from './carry-over-file-marks.ts';
import { test } from './testing/test.ts';

describe('carryOverFileMarks', () => {
  test('keeps a mark on a file whose diff is unchanged', ({ expect }) => {
    const carried = carryOverFileMarks(
      [{ path: 'src/a.ts', diffId: id('a') }],
      [
        { path: 'src/a.ts', diffId: id('a') },
        { path: 'src/b.ts', diffId: id('b') },
      ],
    );
    expect(carried.states).toStrictEqual(['yes', 'no']);
    expect(carried.counts).toStrictEqual({ total: 2, reviewed: 1, changedSince: 0, unreviewed: 1 });
    expect(carried.orphanedPaths).toStrictEqual([]);
  });

  test('reports a file whose diff changed as changed-since, not lost', ({ expect }) => {
    const carried = carryOverFileMarks(
      [{ path: 'src/a.ts', diffId: id('a') }],
      [{ path: 'src/a.ts', diffId: id('z') }],
    );
    expect(carried.states).toStrictEqual(['changed-since']);
    expect(carried.counts).toStrictEqual({ total: 1, reviewed: 0, changedSince: 1, unreviewed: 0 });
  });

  test('follows a renamed file by its other-side path when the diff is the same', ({ expect }) => {
    const carried = carryOverFileMarks(
      [{ path: 'src/old.ts', diffId: id('a') }],
      [{ path: 'src/new.ts', oldPath: 'src/old.ts', diffId: id('a') }],
    );
    expect(carried.states).toStrictEqual(['yes']);
    expect(carried.orphanedPaths).toStrictEqual([]);
  });

  test('marks a renamed file changed-since when its diff also changed', ({ expect }) => {
    const carried = carryOverFileMarks(
      [{ path: 'src/old.ts', diffId: id('a') }],
      [{ path: 'src/new.ts', oldPath: 'src/old.ts', diffId: id('b') }],
    );
    expect(carried.states).toStrictEqual(['changed-since']);
  });

  test('follows a moved file that git shows as a removal plus an addition', ({ expect }) => {
    const carried = carryOverFileMarks(
      [{ path: 'old.ts', diffId: id('a') }],
      [{ path: 'new.ts', diffId: id('a') }],
    );
    expect(carried.states).toStrictEqual(['yes']);
    expect(carried.orphanedPaths).toStrictEqual([]);
  });

  test('does not hand one mark to two files with the same diff', ({ expect }) => {
    const carried = carryOverFileMarks(
      [{ path: 'old.ts', diffId: id('a') }],
      [
        { path: 'x.ts', diffId: id('a') },
        { path: 'y.ts', diffId: id('a') },
      ],
    );
    expect(carried.states).toStrictEqual(['yes', 'no']);
  });

  test('reports the marks of removed files as orphaned without dropping them', ({ expect }) => {
    const carried = carryOverFileMarks(
      [
        { path: 'gone.ts', diffId: id('a') },
        { path: 'src/a.ts', diffId: id('b') },
      ],
      [{ path: 'src/a.ts', diffId: id('b') }],
    );
    expect(carried.states).toStrictEqual(['yes']);
    expect(carried.orphanedPaths).toStrictEqual(['gone.ts']);
    expect(carried.counts.total).toBe(1);
  });

  test('prefers the file at the marked path over a rename claiming it', ({ expect }) => {
    const carried = carryOverFileMarks(
      [{ path: 'a.ts', diffId: id('a') }],
      [
        { path: 'b.ts', oldPath: 'a.ts', diffId: id('a') },
        { path: 'a.ts', diffId: id('a') },
      ],
    );
    expect(carried.states).toStrictEqual(['no', 'yes']);
  });

  test('keeps a mark across a rebase that leaves the file diff alone (full to full)', ({
    expect,
  }) => {
    const reviewedAtOldHead = [{ path: 'src/a.ts', diffId: id('a') }];
    const afterRebase = [
      { path: 'src/a.ts', diffId: id('a') },
      { path: 'src/c.ts', diffId: id('c') },
    ];
    expect(carryOverFileMarks(reviewedAtOldHead, afterRebase).states).toStrictEqual(['yes', 'no']);
  });

  test('reads a file of an interdiff as changed-since a mark made on the full diff', ({
    expect,
  }) => {
    const markedOnFullDiff = [{ path: 'src/a.ts', diffId: id('full') }];
    const interdiff = [{ path: 'src/a.ts', diffId: id('since') }];
    expect(carryOverFileMarks(markedOnFullDiff, interdiff).states).toStrictEqual(['changed-since']);
    const markedOnInterdiff = [{ path: 'src/a.ts', diffId: id('since') }];
    expect(carryOverFileMarks(markedOnInterdiff, interdiff).states).toStrictEqual(['yes']);
  });

  test('answers an empty diff', ({ expect }) => {
    expect(carryOverFileMarks([], [])).toStrictEqual({
      states: [],
      counts: { total: 0, reviewed: 0, changedSince: 0, unreviewed: 0 },
      orphanedPaths: [],
    });
  });
});

function id(seed: string): string {
  return seed.repeat(64).slice(0, 64);
}
