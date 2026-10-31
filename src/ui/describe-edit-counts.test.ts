import { describe } from 'vitest';

import { describeEditCounts } from './describe-edit-counts.ts';
import { test } from './testing/test.ts';

describe('describeEditCounts', () => {
  test('names files, and commits when there are any', ({ expect }) => {
    expect(describeEditCounts({ files: 1, commits: 0 })).toBe('1 file changed');
    expect(describeEditCounts({ files: 3, commits: 2 })).toBe('3 files changed, 2 commits');
  });
});
