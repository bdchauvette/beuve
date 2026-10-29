import type { ChatPromptBudget } from './build-chat-prompt.ts';

/**
 * About 50k tokens of context, less than a review's: a question usually needs a few files, which
 * the model can read from the worktree. Questions over the limit are refused, not truncated.
 */
export const defaultChatPromptBudget: ChatPromptBudget = {
  maxChars: 200_000,
  maxFileChars: 40_000,
  maxQuestionChars: 8000,
  maxFocusChars: 8000,
  maxIntentChars: 6000,
  maxHistoryChars: 40_000,
  maxHistoryTurns: 20,
  maxImpactFindings: 20,
  maxSelectionChars: 60_000,
  maxSelectionFileChars: 30_000,
  maxSummaryChars: 16_000,
};
