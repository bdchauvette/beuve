import type { ReviewQueueItemView } from '#contract/ipc-contract.ts';

/** A queue item before the local review state and stacks are added to it. */
export type QueueItemDraft = Omit<ReviewQueueItemView, 'local' | 'stack'>;
