import { describe, expect, it } from 'vitest';

import { planStepHighlight } from './plan-step-highlight.ts';

describe('planStepHighlight', () => {
  it('confines a split highlight to the head side of a replacement', () => {
    expect(planStepHighlight('split', { side: 'additions', start: 3, end: 4 })).toEqual({
      activeLineSide: 'additions',
    });
  });

  it('keeps a pure deletion on the base side', () => {
    expect(planStepHighlight('split', { side: 'deletions', start: 3, end: 4 })).toEqual({
      activeLineSide: 'deletions',
    });
  });

  it('leaves inline diffs and missing steps alone', () => {
    expect(planStepHighlight('unified', { side: 'additions', start: 1, end: 1 })).toBeUndefined();
    expect(planStepHighlight('split', undefined)).toBeUndefined();
  });
});
