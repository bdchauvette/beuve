import { describe } from 'vitest';

import { nounFor } from './noun-for.ts';
import { test } from './testing/test.ts';

describe('nounFor', () => {
  test('adds an s for any count but one', ({ expect }) => {
    expect([0, 1, 2].map((count) => nounFor(count, 'file'))).toStrictEqual([
      'files',
      'file',
      'files',
    ]);
  });

  test('uses the given plural', ({ expect }) => {
    const forms = { one: 'stays', other: 'stay' };
    expect([1, 2].map((count) => nounFor(count, forms))).toStrictEqual(['stays', 'stay']);
  });
});
