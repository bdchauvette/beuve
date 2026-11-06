import type {
  LocalReviewStateView,
  QueueSortView,
  ReviewQueueItemView,
  TurnView,
} from '#contract/ipc-contract.ts';

type Compare = (left: ReviewQueueItemView, right: ReviewQueueItemView) => number;

const turnRanks: Readonly<Record<TurnView, number>> = {
  you: 0,
  reviewers: 1,
  author: 2,
  unknown: 3,
};

const localRanks: Readonly<Record<LocalReviewStateView, number>> = {
  'new-commits': 0,
  partial: 1,
  opened: 2,
  none: 3,
  reviewed: 4,
};

/**
 * The queue items in the order `sort` names (ADR 0113): your turn first (then waiting longest),
 * waiting longest, oldest, recently updated, smallest, largest (unknown sizes last), stack order
 * (each stack in stack order, stacks together, in your-turn order of their first item), or new since
 * your review (then recently updated). Ties break on repository, then number or branch, so the
 * order never depends on the input's. Pure.
 */
export function sortQueueItems(
  items: readonly ReviewQueueItemView[],
  sort: QueueSortView,
): ReviewQueueItemView[] {
  if (sort === 'stack') {
    return stackOrder(items);
  }
  const compare = comparers[sort];
  return items.toSorted((left, right) => compare(left, right) || compareIdentity(left, right));
}

const comparers: Readonly<Record<Exclude<QueueSortView, 'stack'>, Compare>> = {
  turn: (left, right) => {
    return (
      turnRanks[left.attention.turn] - turnRanks[right.attention.turn] ||
      compareInstants(left.waitingSince, right.waitingSince)
    );
  },
  waiting: (left, right) => {
    return compareInstants(left.waitingSince, right.waitingSince);
  },
  oldest: (left, right) => {
    return compareInstants(left.createdAt, right.createdAt);
  },
  updated: (left, right) => {
    return compareInstants(right.updatedAt, left.updatedAt);
  },
  smallest: (left, right) => {
    return compareUnknownSizeLast(left, right) || linesOf(left) - linesOf(right);
  },
  largest: (left, right) => {
    return compareUnknownSizeLast(left, right) || linesOf(right) - linesOf(left);
  },
  'new-since-review': (left, right) => {
    return (
      localRanks[left.local.state] - localRanks[right.local.state] ||
      compareInstants(right.updatedAt, left.updatedAt)
    );
  },
};

/**
 * Each stack kept together in its order (bottom first, each pull request before those based on
 * it); stacks in your-turn order of their first item.
 */
function stackOrder(items: readonly ReviewQueueItemView[]): ReviewQueueItemView[] {
  const byTurn = sortQueueItems(items, 'turn');
  const stacks = new Map<string, ReviewQueueItemView[]>();
  for (const item of byTurn) {
    const id = item.stack?.id ?? item.key;
    stacks
      .getOrInsertComputed(id, () => {
        return [];
      })
      .push(item);
  }
  return stacks
    .values()
    .flatMap((stack) => {
      return stack.toSorted((left, right) => {
        return (
          (left.stack?.position ?? 0) - (right.stack?.position ?? 0) || compareIdentity(left, right)
        );
      });
    })
    .toArray();
}

function compareInstants(left: string, right: string): number {
  return Temporal.Instant.compare(Temporal.Instant.from(left), Temporal.Instant.from(right));
}

/** Items of unknown size after those of known size. */
function compareUnknownSizeLast(left: ReviewQueueItemView, right: ReviewQueueItemView): number {
  return Number(left.size === undefined) - Number(right.size === undefined);
}

/** Lines added and deleted; 0 when unknown. */
function linesOf(item: ReviewQueueItemView): number {
  return (item.size?.additions ?? 0) + (item.size?.deletions ?? 0);
}

/** Repository, then number, then branch: a total order over distinct items. */
function compareIdentity(left: ReviewQueueItemView, right: ReviewQueueItemView): number {
  return (
    `${left.host}/${left.owner}/${left.repo}`
      .toLowerCase()
      .localeCompare(`${right.host}/${right.owner}/${right.repo}`.toLowerCase()) ||
    (left.number ?? 0) - (right.number ?? 0) ||
    (left.branch ?? '').localeCompare(right.branch ?? '') ||
    left.key.localeCompare(right.key)
  );
}
