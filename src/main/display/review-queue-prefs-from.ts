import { defaultReviewQueuePrefs } from '#contract/default-review-queue-prefs.ts';
import type { ReviewQueuePrefsView } from '#contract/ipc-contract.ts';

import { reviewQueuePrefsSchema } from './review-queue-prefs-schema.ts';

/**
 * The stored review queue preferences (ADR 0113), or the defaults when they are missing or
 * malformed (written by another version, say). Pure.
 */
export function reviewQueuePrefsFrom(stored: unknown): ReviewQueuePrefsView {
  const parsed = reviewQueuePrefsSchema.safeParse(stored);
  if (parsed.success) {
    return parsed.data;
  }
  return defaultReviewQueuePrefs;
}
