import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { headRowSelector } from './head-row-selector.ts';

describe('headRowSelector', () => {
  test('looks every row up in the single column inline', ({ expect }) => {
    expect(headRowSelector('unified', 'context', 12)).toBe(
      "code[data-unified] [data-line='12'][data-line-type='context']",
    );
    expect(headRowSelector('unified', 'deletions', 3)).toBe(
      "code[data-unified] [data-line='3'][data-line-type='change-deletion']",
    );
  });

  test('looks head lines up on the right and deleted lines on the left when split', ({
    expect,
  }) => {
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
