import type { ReviewView } from '#contract/ipc-contract.ts';

import type { SavedProgress } from './session-controller.ts';

/** What the status bar says about saved progress (ADR 0157). */
export type SaveState =
  | { readonly kind: 'saving' }
  /** The head is saved; `at` is ISO-8601 when the save's time is known. */
  | { readonly kind: 'saved'; readonly sha: string; readonly at?: string }
  /** The head is not saved; `since` is the last saved head, absent before the first save. */
  | { readonly kind: 'unsaved'; readonly since?: string };

/** What {@link saveStateFrom} reads. */
export interface SaveFacts {
  readonly review: ReviewView | undefined;
  /** This window's last save, which a save that kept the review shown has not reloaded yet. */
  readonly savedProgress: SavedProgress | undefined;
  readonly isMarking: boolean;
}

/**
 * Whether the open review's head is saved (ADR 0157): by this window's last save on it, or by the
 * session's last checkpoint as loaded. `undefined` without a review. Pure.
 */
export function saveStateFrom({
  review,
  savedProgress,
  isMarking,
}: SaveFacts): SaveState | undefined {
  if (review === undefined) {
    return undefined;
  }
  if (isMarking) {
    return { kind: 'saving' };
  }
  const { headSha, session } = review;
  if (savedProgress?.sessionId === session.id && savedProgress.sha === headSha) {
    return { kind: 'saved', sha: headSha, at: savedProgress.at.toString() };
  }
  if (session.lastReviewedSha === headSha) {
    const checkpoint = review.range?.checkpoints.at(-1);
    if (checkpoint?.headSha === headSha) {
      return { kind: 'saved', sha: headSha, at: checkpoint.savedAt };
    }
    return { kind: 'saved', sha: headSha };
  }
  if (savedProgress?.sessionId === session.id) {
    return { kind: 'unsaved', since: savedProgress.sha };
  }
  if (session.lastReviewedSha === undefined) {
    return { kind: 'unsaved' };
  }
  return { kind: 'unsaved', since: session.lastReviewedSha };
}
