import { describe } from 'vitest';

import { describeInsight } from './describe-insight.ts';
import { createFindingView } from './testing/create-finding-view.ts';
import { test } from './testing/test.ts';

describe('describeInsight', () => {
  test('words the severity and category, and flags only unconfirmed findings', ({ expect }) => {
    expect(
      describeInsight(createFindingView({ category: 'error-handling', severity: 'risk' })),
    ).toStrictEqual({
      severity: 'Risk',
      category: 'error handling',
      isUnconfirmed: false,
      summary: 'Risk insight, error handling',
    });
    expect(describeInsight(createFindingView({ check: 'unconfirmed' }))).toMatchObject({
      isUnconfirmed: true,
      summary: 'Warning insight, edge case, unconfirmed',
    });
    expect(describeInsight(createFindingView({ check: 'unchecked' }))).toMatchObject({
      isUnconfirmed: false,
    });
  });
});
