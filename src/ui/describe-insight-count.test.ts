import { describe } from 'vitest';

import { describeInsightCount } from './describe-insight-count.ts';
import { test } from './testing/test.ts';

describe('describeInsightCount', () => {
  test('counts insights with the right plural', ({ expect }) => {
    expect(describeInsightCount(1)).toBe('1 insight');
    expect(describeInsightCount(2)).toBe('2 insights');
  });
});
