import type { PromptBudget } from './build-review-prompt.ts';

/**
 * About 75k tokens of diff, leaving room in the model's context for the files it reads. One file
 * gets at most a fifth, so a generated or vendored file can't crowd out the rest.
 */
export const defaultPromptBudget: PromptBudget = {
  maxChars: 300_000,
  maxFileChars: 60_000,
  maxIntentChars: 8000,
  maxImpactFindings: 40,
  maxInsights: 12,
};
