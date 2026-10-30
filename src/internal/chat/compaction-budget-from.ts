import type { CompactionBudget } from './build-compaction-prompt.ts';
import { chatPromptBudgetFrom } from './chat-prompt-budget-from.ts';
import type { ChatModelCapabilities } from './chat-model.ts';
import { defaultChatPromptBudget } from './default-chat-prompt-budget.ts';

const defaultBudget: CompactionBudget = {
  maxTurnsChars: 120_000,
  maxTurnChars: 12_000,
  maxSummaryChars: 16_000,
  maxListedFiles: 200,
};

/**
 * The `/compact` prompt's limits for a model (ADR 0047, 0070): the defaults scaled as
 * {@link chatPromptBudgetFrom} scales the chat's, never below a few turns' worth.
 */
export function compactionBudgetFrom(
  capabilities: ChatModelCapabilities | undefined,
): CompactionBudget {
  const scale = chatPromptBudgetFrom(capabilities).maxChars / defaultChatPromptBudget.maxChars;
  if (scale === 1) {
    return defaultBudget;
  }
  return {
    maxTurnsChars: Math.max(6000, Math.floor(defaultBudget.maxTurnsChars * scale)),
    maxTurnChars: Math.max(1500, Math.floor(defaultBudget.maxTurnChars * scale)),
    maxSummaryChars: Math.max(1500, Math.floor(defaultBudget.maxSummaryChars * scale)),
    maxListedFiles: Math.max(20, Math.floor(defaultBudget.maxListedFiles * Math.min(1, scale))),
  };
}
