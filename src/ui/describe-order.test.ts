import { describe } from 'vitest';

import { describeOrder } from './describe-order.ts';
import { test } from './testing/test.ts';

describe('describeOrder', () => {
  test.for([
    ['path', 'Files in path order'],
    ['imports', 'Files by imports: what a file uses comes before it'],
    ['calls', 'Files by calls: what a function calls comes before it'],
  ] as const)('%s', ([mode, text], { expect }) => {
    expect(describeOrder(mode)).toBe(text);
  });

  test('defaults to path order', ({ expect }) => {
    expect(describeOrder()).toBe('Files in path order');
  });
});
