import { describe } from 'vitest';

import { describeSheets } from './describe-sheets.ts';
import { test } from './testing/test.ts';

describe('describeSheets', () => {
  test('says where definitions open', ({ expect }) => {
    expect(describeSheets('inline')).toBe('Definitions open over the diff.');
    expect(describeSheets('window')).toBe('Definitions open in a new sheet window each.');
    expect(describeSheets(undefined)).toBe('Definitions open in a new sheet window each.');
  });
});
