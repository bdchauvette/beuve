import { describe, expect, it } from 'vitest';

import type { ModelInsight } from './insight-output-schema.ts';
import { createReviewInput } from './testing/create-review-input.ts';
import { validateInsights } from './validate-insights.ts';

const limits = { maxInsights: 10, minConfidence: 0.3 };

function insight(overrides: Partial<ModelInsight>): ModelInsight {
  return {
    path: 'src/a.ts',
    lineStart: 12,
    lineEnd: 12,
    severity: 'warning',
    category: 'edge-case',
    title: 'Empty input',
    body: 'An empty string yields `undefined`.',
    confidence: 0.8,
    ...overrides,
  };
}

describe('validateInsights', () => {
  it('keeps insights on diff lines and drops those outside the diff or its files', () => {
    const input = createReviewInput({
      files: [
        ...createReviewInput().files,
        {
          path: 'src/gone.ts',
          status: 'deleted',
          binary: false,
          patch: '@@ -1,2 +0,0 @@\n-a\n-b\n',
        },
      ],
    });
    const result = validateInsights(
      [
        insight({}),
        insight({ path: 'src/a.ts', lineStart: 1, lineEnd: 3, title: 'Before the hunk' }),
        insight({ path: 'src/elsewhere.ts', title: 'Not in the diff' }),
        insight({ path: 'src/gone.ts', lineStart: 1, lineEnd: 1, title: 'Deleted file' }),
        insight({ path: '/etc/passwd', title: 'Outside the worktree' }),
        insight({ path: './src/b.ts', lineStart: 2, lineEnd: 2, title: 'Dot slash' }),
        insight({ path: '/work/repo/src/b.ts', lineStart: 3, lineEnd: 3, title: 'Absolute' }),
      ],
      input,
      limits,
    );
    expect(result.insights.map((kept) => [kept.path, kept.lineStart, kept.title])).toEqual([
      ['src/a.ts', 12, 'Empty input'],
      ['src/b.ts', 2, 'Dot slash'],
      ['src/b.ts', 3, 'Absolute'],
    ]);
    expect(result.dropped).toEqual({
      unknownFile: 3,
      outsideDiff: 1,
      lowConfidence: 0,
      duplicate: 0,
      overLimit: 0,
    });
  });

  it('narrows ranges to the touched hunks and orders reversed ranges', () => {
    const result = validateInsights(
      [insight({ lineStart: 30, lineEnd: 8 })],
      createReviewInput(),
      limits,
    );
    expect(result.insights[0]).toMatchObject({ lineStart: 10, lineEnd: 14 });
    expect(result.clamped).toBe(1);
  });

  it('normalizes text and drops duplicates and low-confidence insights', () => {
    const result = validateInsights(
      [
        insight({ title: '  Empty\n input ', body: '  body  ' }),
        insight({ title: 'empty input' }),
        insight({ title: 'Unsure', confidence: 0.1 }),
      ],
      createReviewInput(),
      limits,
    );
    expect(result.insights).toEqual([insight({ title: 'Empty input', body: 'body' })]);
    expect(result.dropped).toMatchObject({ duplicate: 1, lowConfidence: 1 });
  });

  it('keeps the most severe and confident insights within the limit, in diff order', () => {
    const result = validateInsights(
      [
        insight({ path: 'src/b.ts', lineStart: 1, lineEnd: 1, title: 'B info', severity: 'info' }),
        insight({ path: 'src/b.ts', lineStart: 2, lineEnd: 2, title: 'B risk', severity: 'risk' }),
        insight({ title: 'A warning sure', confidence: 0.9 }),
        insight({ title: 'A warning unsure', confidence: 0.5 }),
      ],
      createReviewInput(),
      { maxInsights: 2, minConfidence: 0 },
    );
    expect(result.insights.map((kept) => kept.title)).toEqual(['A warning sure', 'B risk']);
    expect(result.dropped.overLimit).toBe(2);
  });
});
