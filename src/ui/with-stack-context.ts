import type { ReviewQueueItemView } from '#contract/ipc-contract.ts';

/** Every item of the queue, and those the filters let through. */
export interface StackContextInput {
  readonly all: readonly ReviewQueueItemView[];
  readonly matched: readonly ReviewQueueItemView[];
}

/**
 * The matched items with the rest of their stacks (ADR 0113 amendment), for grouping by stack: a
 * stack always shows whole, so a member not waiting on the viewer (a context row) or one the
 * filters hide comes back beside a member that matched. A stack none of whose members matched
 * stays hidden. The matched items come first, in their order, then the others in the queue's.
 * Pure.
 */
export function withStackContext({ all, matched }: StackContextInput): ReviewQueueItemView[] {
  const shown = new Set(matched);
  const stacks = new Set(matched.map((item) => item.stack?.id).filter((id) => id !== undefined));
  const others = all.filter((item) => {
    return !shown.has(item) && item.stack !== undefined && stacks.has(item.stack.id);
  });
  return [...matched, ...others];
}
