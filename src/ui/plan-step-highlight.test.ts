import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { planStepHighlight } from './plan-step-highlight.ts';

describe('planStepHighlight', () => {
  test('confines a split highlight to the head side of a replacement', ({ expect }) => {
    expect(planStepHighlight('split', { side: 'additions', start: 3, end: 4 })).toStrictEqual({
      activeLineSide: 'additions',
    });
  });

  test('keeps a pure deletion on the base side', ({ expect }) => {
    expect(planStepHighlight('split', { side: 'deletions', start: 3, end: 4 })).toStrictEqual({
      activeLineSide: 'deletions',
    });
  });

  test('leaves inline diffs and missing steps alone', ({ expect }) => {
    expect(planStepHighlight('unified', { side: 'additions', start: 1, end: 1 })).toBeUndefined();
    expect(planStepHighlight('split', undefined)).toBeUndefined();
  });
});
