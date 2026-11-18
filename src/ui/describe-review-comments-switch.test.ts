import { describe } from 'vitest';

import { describeReviewCommentsSwitch } from './describe-review-comments-switch.ts';
import { test } from './testing/test.ts';

describe('describeReviewCommentsSwitch', () => {
  test('says whether the comments are shown and how to change it', ({ expect }) => {
    expect(describeReviewCommentsSwitch(true)).toContain('shown on the diff');
    expect(describeReviewCommentsSwitch(false)).toContain('hidden');
  });
});
