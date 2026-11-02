import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { reviewedDecorations } from './reviewed-decorations.ts';

describe('reviewedDecorations', () => {
  test('marks reviewed files and files changed since, and leaves unmarked ones out', ({
    expect,
  }) => {
    expect(
      reviewedDecorations(
        new Map([
          ['src/a.ts', 'yes'],
          ['src/b.ts', 'changed-since'],
          ['src/c.ts', 'no'],
        ] as const),
      ),
    ).toStrictEqual(
      new Map([
        ['src/a.ts', { text: '✓', title: 'Reviewed' }],
        ['src/b.ts', { text: '◦', title: 'Changed since you marked it reviewed' }],
      ]),
    );
  });

  test('is empty when nothing is marked', ({ expect }) => {
    expect(reviewedDecorations(new Map([['src/a.ts', 'no']] as const))).toStrictEqual(new Map());
  });
});
