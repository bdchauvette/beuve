import { describe } from 'vitest';

import { mergeReviewInsights } from './merge-review-insights.ts';
import { createFindingView } from './testing/create-finding-view.ts';
import { createReviewMessageView } from './testing/create-review-message-view.ts';
import { test } from './testing/test.ts';
import { withoutStagedInsights } from './without-staged-insights.ts';

describe('withoutStagedInsights', () => {
  test('drops the insights whose finding is staged, from any run that made them', ({ expect }) => {
    const insights = mergeReviewInsights(
      [
        createReviewMessageView([createFindingView({ title: 'Repeated' })], {
          id: 'older',
          createdAt: '2026-10-30T10:00:00.000Z',
        }),
        createReviewMessageView(
          [
            createFindingView({ title: 'Repeated' }),
            createFindingView({ path: 'src/b.ts', title: 'Other' }),
          ],
          { id: 'newer', createdAt: '2026-10-30T11:00:00.000Z' },
        ),
      ],
      'a'.repeat(40),
    );
    expect(withoutStagedInsights(insights, new Set()).map(({ key }) => key)).toStrictEqual([
      'newer:0',
      'newer:1',
    ]);
    expect(
      withoutStagedInsights(insights, new Set(['older:0'])).map(({ key }) => key),
    ).toStrictEqual(['newer:1']);
    expect(
      withoutStagedInsights(insights, new Set(['newer:1'])).map(({ key }) => key),
    ).toStrictEqual(['newer:0']);
  });
});
