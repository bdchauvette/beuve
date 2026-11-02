import { describe } from 'vitest';

import { describeInsights } from './describe-insights.ts';
import { test } from './testing/test.ts';

describe('describeInsights', () => {
  test('says whether findings annotate the diff', ({ expect }) => {
    expect(describeInsights(true)).toContain('shown');
    expect(describeInsights(false)).toContain('hidden');
  });
});
