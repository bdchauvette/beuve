import type { ReviewQueuePrefsView } from './ipc-contract.ts';

/**
 * The review queue's preferences until the reviewer changes them (ADR 0113): your turn first, no
 * grouping, and every item but the viewer's own pull requests that are someone else's turn.
 */
export const defaultReviewQueuePrefs: ReviewQueuePrefsView = Object.freeze({
  sort: 'turn',
  group: 'none',
  filters: Object.freeze({
    kinds: [],
    repositories: [],
    authors: [],
    request: 'any',
    hideDrafts: false,
    ci: [],
    turns: [],
    local: [],
    showWaitingOnOthers: false,
  }),
});
