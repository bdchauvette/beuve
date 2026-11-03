import type { TimelineEventView } from '#contract/ipc-contract.ts';

/** What the Overview's activity list has: loading, the events, or why there are none. */
export type TimelineState =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'ready';
      readonly events: readonly TimelineEventView[];
      /** GitHub had more than was read. */
      readonly isTruncated: boolean;
    }
  | { readonly kind: 'failed'; readonly message: string };
