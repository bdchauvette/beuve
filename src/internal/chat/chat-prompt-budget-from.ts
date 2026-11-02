import type { ChatPromptBudget } from './build-chat-prompt.ts';
import type { ChatModelCapabilities } from './chat-model.ts';
import { defaultChatPromptBudget } from './default-chat-prompt-budget.ts';

/** A conservative characters-per-token ratio for code and prose. */
const charsPerToken = 3.5;
const minChars = 12_000;
const maxChars = 600_000;

/** The least each scaled limit gets, so a question and a small diff stay usable. */
const floors = {
  maxFileChars: 4000,
  maxQuestionChars: 2000,
  maxFocusChars: 1000,
  maxIntentChars: 1000,
  maxHistoryChars: 2000,
  maxSelectionChars: 3000,
  maxSelectionFileChars: 2000,
  maxSummaryChars: 1500,
} as const satisfies Partial<Record<keyof ChatPromptBudget, number>>;

/**
 * The prompt budget for a model (ADR 0070): {@link defaultChatPromptBudget} when its context
 * window is unknown, otherwise a share of the window, a quarter for a model with tools (the rest
 * is for the files it reads, its turns and the answer) and half without, between 12k and 600k
 * characters. Every limit scales with the whole, none below a floor that keeps a question and a
 * small diff usable; the turn and finding counts stay.
 */
export function chatPromptBudgetFrom(
  capabilities: ChatModelCapabilities | undefined,
): ChatPromptBudget {
  const tokens = capabilities?.contextWindowTokens;
  if (tokens === undefined || !Number.isFinite(tokens) || tokens <= 0) {
    return defaultChatPromptBudget;
  }
  let share = 0.25;
  if (capabilities?.tools === false) {
    share = 0.5;
  }
  const total = Math.min(maxChars, Math.max(minChars, Math.floor(tokens * share * charsPerToken)));
  const scale = total / defaultChatPromptBudget.maxChars;
  const base = defaultChatPromptBudget;
  const scaled = (limit: keyof typeof floors): number => {
    return Math.max(floors[limit], Math.floor(base[limit] * scale));
  };
  return {
    maxChars: total,
    maxFileChars: scaled('maxFileChars'),
    maxQuestionChars: scaled('maxQuestionChars'),
    maxFocusChars: scaled('maxFocusChars'),
    maxIntentChars: scaled('maxIntentChars'),
    maxHistoryChars: scaled('maxHistoryChars'),
    maxHistoryTurns: base.maxHistoryTurns,
    maxSelectionChars: scaled('maxSelectionChars'),
    maxSelectionFileChars: scaled('maxSelectionFileChars'),
    maxSummaryChars: scaled('maxSummaryChars'),
  };
}
