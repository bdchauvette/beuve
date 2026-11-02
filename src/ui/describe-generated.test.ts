import { describe } from 'vitest';

import { describeGenerated } from './describe-generated.ts';
import { test } from './testing/test.ts';

describe('describeGenerated', () => {
  test('says whether generated files are expanded', ({ expect }) => {
    expect(describeGenerated(true)).toContain('shown');
    expect(describeGenerated(false)).toContain('collapsed');
  });
});
