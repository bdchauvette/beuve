import { describe } from 'vitest';

import { describeSkipReviewed } from './describe-skip-reviewed.ts';
import { test } from './testing/test.ts';

describe('describeSkipReviewed', () => {
  test('says what Next and Previous Change do', ({ expect }) => {
    expect(describeSkipReviewed(true)).toContain('skip files marked reviewed');
    expect(describeSkipReviewed(false)).toContain('stop at every file');
    expect(describeSkipReviewed(undefined)).toContain('stop at every file');
  });
});
