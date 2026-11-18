import type { ReviewThreadView } from '#contract/ipc-contract.ts';

/** Where a file card shows other reviewers' threads (ADR 0140). */
export interface ThreadPlacement {
  /** Under their last line in the diff: head-side threads on the head the card shows. */
  readonly inline: readonly ReviewThreadView[];
  /** In the card's list of comments that are not on lines it shows. */
  readonly aside: readonly ReviewThreadView[];
}

/**
 * Splits a file's threads between the diff and the card's list (ADR 0140). A thread is drawn on
 * its lines only when it is on the head side, is not outdated, has lines, and is numbered at
 * `headSha`, the head the card shows; everything else (base side, outdated, whole file, another
 * commit) goes to the list, so no thread is put on lines it may not belong to. Pure.
 */
export function placeReviewThreads(
  threads: readonly ReviewThreadView[],
  headSha: string,
): ThreadPlacement {
  const inline: ReviewThreadView[] = [];
  const aside: ReviewThreadView[] = [];
  for (const thread of threads) {
    const isPlaced =
      thread.side === 'head' &&
      !thread.isOutdated &&
      thread.endLine !== undefined &&
      thread.sha === headSha;
    if (isPlaced) {
      inline.push(thread);
    } else {
      aside.push(thread);
    }
  }
  return { inline, aside };
}
