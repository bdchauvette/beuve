import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { descriptionSheetTitleFrom } from './description-sheet-title-from.ts';

describe('descriptionSheetTitleFrom', () => {
  test('names the number and title, and says it is the description', ({ expect }) => {
    expect(descriptionSheetTitleFrom({ number: 42, title: 'Fix the flux' })).toBe(
      '#42 Fix the flux · description',
    );
  });
});
