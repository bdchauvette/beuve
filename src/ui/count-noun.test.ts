import { describe } from 'vitest';

import { countNoun } from './count-noun.ts';
import { test } from './testing/test.ts';

describe('countNoun', () => {
  test('writes the count before the matching form', ({ expect }) => {
    expect(countNoun(1, 'file')).toBe('1 file');
    expect(countNoun(0, 'file')).toBe('0 files');
    expect(countNoun(3, { one: 'blocker is', other: 'blockers are' })).toBe('3 blockers are');
  });
});
