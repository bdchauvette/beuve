import { describe } from 'vitest';

import { compactionBudgetFrom } from './compaction-budget-from.ts';
import { test } from './testing/test.ts';

describe('compactionBudgetFrom', () => {
  test('keeps the defaults for an unknown window and scales them for a small one', ({ expect }) => {
    expect(compactionBudgetFrom(undefined)).toStrictEqual({
      maxTurnsChars: 120_000,
      maxTurnChars: 12_000,
      maxSummaryChars: 16_000,
      maxListedFiles: 200,
    });
    expect(compactionBudgetFrom({ tools: false, contextWindowTokens: 8192 })).toStrictEqual({
      maxTurnsChars: 8601,
      maxTurnChars: 1500,
      maxSummaryChars: 1500,
      maxListedFiles: 20,
    });
  });
});
