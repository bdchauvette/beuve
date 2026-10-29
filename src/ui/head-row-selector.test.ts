import { describe, expect, it } from 'vitest';

import { headRowSelector } from './head-row-selector.ts';

describe('headRowSelector', () => {
  it('looks every row up in the single column inline', () => {
    expect(headRowSelector('unified', 'context', 12)).toBe(
      "code[data-unified] [data-line='12'][data-line-type='context']",
    );
    expect(headRowSelector('unified', 'deletions', 3)).toBe(
      "code[data-unified] [data-line='3'][data-line-type='change-deletion']",
    );
  });

  it('looks head lines up on the right and deleted lines on the left when split', () => {
    expect(headRowSelector('split', 'additions', 7)).toBe(
      "code[data-additions] [data-line='7'][data-line-type='change-addition']",
    );
    expect(headRowSelector('split', 'context', 7)).toBe(
      "code[data-additions] [data-line='7'][data-line-type='context']",
    );
    expect(headRowSelector('split', 'deletions', 7)).toBe(
      "code[data-deletions] [data-line='7'][data-line-type='change-deletion']",
    );
  });
});
