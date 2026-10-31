import type { ChatPromptBudget } from './build-chat-prompt.ts';
import type { ChatModelCapabilities } from './chat-model.ts';
import { defaultChatPromptBudget } from './default-chat-prompt-budget.ts';

/** A conservative characters-per-token ratio for code and prose. */
const charsPerToken = 3.5;
const minChars = 12_000;
const maxChars = 600_000;

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
  const share = capabilities?.tools === false ? 0.5 : 0.25;
  const total = Math.min(maxChars, Math.max(minChars, Math.floor(tokens * share * charsPerToken)));
  const scale = total / defaultChatPromptBudget.maxChars;
  const scaled = (value: number, floor: number): number => {
    return Math.max(floor, Math.floor(value * scale));
  };
  const base = defaultChatPromptBudget;
  return {
    maxChars: total,
    maxFileChars: scaled(base.maxFileChars, 4000),
    maxQuestionChars: scaled(base.maxQuestionChars, 2000),
    maxFocusChars: scaled(base.maxFocusChars, 1000),
    maxIntentChars: scaled(base.maxIntentChars, 1000),
    maxHistoryChars: scaled(base.maxHistoryChars, 2000),
    maxHistoryTurns: base.maxHistoryTurns,
    maxImpactFindings: base.maxImpactFindings,
    maxSelectionChars: scaled(base.maxSelectionChars, 3000),
    maxSelectionFileChars: scaled(base.maxSelectionFileChars, 2000),
    maxSummaryChars: scaled(base.maxSummaryChars, 1500),
  };
}
