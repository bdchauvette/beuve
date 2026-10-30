import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { planHunkSteps } from './plan-hunk-steps.ts';

describe('planHunkSteps', () => {
  test('steps to the first changed run of each hunk, deletions first', ({ expect }) => {
    expect(
      planHunkSteps([
        {
          additionStart: 10,
          deletionStart: 9,
          hunkContent: [
            { type: 'context', lines: 3 },
            { type: 'change', additions: 2, deletions: 0 },
            { type: 'context', lines: 3 },
            { type: 'change', additions: 0, deletions: 4 },
          ],
        },
        {
          additionStart: 40,
          deletionStart: 41,
          hunkContent: [
            { type: 'context', lines: 1 },
            { type: 'change', additions: 1, deletions: 2 },
          ],
        },
        {
          additionStart: 1,
          deletionStart: 0,
          hunkContent: [{ type: 'change', additions: 5, deletions: 0 }],
        },
      ]),
    ).toStrictEqual([
      { side: 'additions', start: 13, end: 14 },
      { side: 'deletions', start: 42, end: 43 },
      { side: 'additions', start: 1, end: 5 },
    ]);
  });

  test('selects the head side of a replacement when split, keeping pure deletions left', ({
    expect,
  }) => {
    const hunks = [
      {
        additionStart: 40,
        deletionStart: 41,
        hunkContent: [
          { type: 'context', lines: 1 },
          { type: 'change', additions: 1, deletions: 2 },
        ],
      },
      {
        additionStart: 60,
        deletionStart: 61,
        hunkContent: [{ type: 'change', additions: 0, deletions: 3 }],
      },
    ] as const;
    expect(planHunkSteps(hunks, 'split')).toStrictEqual([
      { side: 'additions', start: 41, end: 41 },
      { side: 'deletions', start: 61, end: 63 },
    ]);
    expect(planHunkSteps(hunks, 'unified')[0]).toStrictEqual({
      side: 'deletions',
      start: 42,
      end: 43,
    });
  });

  test('falls back to the first head line of a hunk without changes', ({ expect }) => {
    expect(
      planHunkSteps([
        { additionStart: 7, deletionStart: 7, hunkContent: [{ type: 'context', lines: 2 }] },
      ]),
    ).toStrictEqual([{ side: 'additions', start: 7, end: 7 }]);
  });
});
