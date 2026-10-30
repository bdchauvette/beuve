import { describe } from 'vitest';

import { chatPromptBudgetFrom } from './chat-prompt-budget-from.ts';
import { defaultChatPromptBudget } from './default-chat-prompt-budget.ts';
import { test } from './testing/test.ts';

describe('chatPromptBudgetFrom', () => {
  test('keeps the default for an unknown context window', ({ expect }) => {
    expect(chatPromptBudgetFrom(undefined)).toBe(defaultChatPromptBudget);
    expect(chatPromptBudgetFrom({ tools: true, contextWindowTokens: undefined })).toBe(
      defaultChatPromptBudget,
    );
    expect(chatPromptBudgetFrom({ tools: false, contextWindowTokens: 0 })).toBe(
      defaultChatPromptBudget,
    );
  });

  test('gives a model with tools a quarter of its window, and one without half', ({ expect }) => {
    const withTools = chatPromptBudgetFrom({ tools: true, contextWindowTokens: 200_000 });
    const without = chatPromptBudgetFrom({ tools: false, contextWindowTokens: 32_768 });
    expect(withTools.maxChars).toBe(175_000);
    expect(without.maxChars).toBe(57_344);
    expect(without.maxFileChars).toBe(Math.floor(40_000 * (57_344 / 200_000)));
    expect(without.maxHistoryTurns).toBe(defaultChatPromptBudget.maxHistoryTurns);
  });

  test('stays between the floor and the ceiling', ({ expect }) => {
    const tiny = chatPromptBudgetFrom({ tools: false, contextWindowTokens: 2048 });
    expect(tiny).toMatchObject({ maxChars: 12_000, maxFileChars: 4000, maxQuestionChars: 2000 });
    expect(chatPromptBudgetFrom({ tools: true, contextWindowTokens: 10_000_000 }).maxChars).toBe(
      600_000,
    );
  });
});
