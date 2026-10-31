import { describe } from 'vitest';

import { firstHunkLine } from './first-hunk-line.ts';
import { test } from './testing/test.ts';

describe('firstHunkLine', () => {
  test('is the start of a side with lines', ({ expect }) => {
    expect(firstHunkLine({ start: 5, count: 2 })).toBe(5);
  });

  test('is the line after an empty side, which names the line before its gap', ({ expect }) => {
    expect(firstHunkLine({ start: 5, count: 0 })).toBe(6);
  });
});
