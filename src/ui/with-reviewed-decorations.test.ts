import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { withReviewedDecorations } from './with-reviewed-decorations.ts';

describe('withReviewedDecorations', () => {
  test('puts the mark before a file’s ImpactGate decoration, or alone', ({ expect }) => {
    const decorations = new Map([['src/a.ts', { text: 'p83', title: 'p83 for this file' }]]);
    expect(
      withReviewedDecorations(
        decorations,
        new Map([
          ['src/a.ts', 'yes'],
          ['src/b.ts', 'changed-since'],
          ['src/c.ts', 'no'],
        ] as const),
      ),
    ).toStrictEqual(
      new Map([
        ['src/a.ts', { text: '✓ p83', title: 'Reviewed. p83 for this file' }],
        ['src/b.ts', { text: '◦', title: 'Changed since you marked it reviewed' }],
      ]),
    );
  });

  test('returns the decorations as they were when nothing is marked', ({ expect }) => {
    const decorations = new Map([['src/a.ts', { text: 'p83', title: '' }]]);
    expect(withReviewedDecorations(decorations, new Map([['src/a.ts', 'no']] as const))).toBe(
      decorations,
    );
  });
});
