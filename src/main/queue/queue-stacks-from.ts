import type { QueueStackView, ReviewQueueItemView } from '#contract/ipc-contract.ts';

/** What stacking reads of an item: where it lives and its head and base branches. */
export type StackableItem = Pick<
  ReviewQueueItemView,
  'key' | 'kind' | 'host' | 'owner' | 'repo' | 'branch' | 'baseBranch'
>;

/**
 * The stacks among the queue's pull requests (ADR 0113), from data already fetched: within one
 * repository, a pull request whose base branch is another queued pull request's head branch sits
 * on it. Items in a stack of two or more get its bottom item's key as the stack id and their
 * distance from it; a stack whose middle is not queued splits in two. Branches without a pull
 * request are never stacked. Pure.
 */
export function queueStacksFrom(
  items: readonly StackableItem[],
): ReadonlyMap<string, QueueStackView> {
  const byHead = new Map<string, StackableItem>();
  for (const item of items) {
    if (item.kind === 'pull-request' && item.branch !== undefined) {
      byHead.set(branchKey(item, item.branch), item);
    }
  }
  const parentOf = (item: StackableItem): StackableItem | undefined => {
    if (item.kind !== 'pull-request' || item.baseBranch === undefined) {
      return undefined;
    }
    const parent = byHead.get(branchKey(item, item.baseBranch));
    if (parent === item) {
      return undefined;
    }
    return parent;
  };
  const placed = new Map<string, Placement>();
  for (const item of items) {
    placed.set(item.key, placementOf(item, parentOf));
  }
  const sizes = new Map<string, number>();
  for (const { root } of placed.values()) {
    sizes.set(root, (sizes.get(root) ?? 0) + 1);
  }
  const stacks = new Map<string, QueueStackView>();
  for (const [key, { root, depth }] of placed) {
    const size = sizes.get(root) ?? 1;
    if (size > 1) {
      stacks.set(key, { id: root, depth, size });
    }
  }
  return stacks;
}

/** Where an item sits: the key of the bottom of its stack, and how far above it. */
interface Placement {
  readonly root: string;
  readonly depth: number;
}

/** Walks down to the bottom of the item's stack; a cycle stops where it would repeat. */
function placementOf(
  item: StackableItem,
  parentOf: (item: StackableItem) => StackableItem | undefined,
): Placement {
  const seen = new Set<string>([item.key]);
  let root = item;
  let depth = 0;
  let parent = parentOf(root);
  while (parent !== undefined && !seen.has(parent.key)) {
    seen.add(parent.key);
    root = parent;
    depth += 1;
    parent = parentOf(root);
  }
  return { root: root.key, depth };
}

/** A branch of the item's repository, case-insensitive in the repository as GitHub is. */
function branchKey(item: StackableItem, branch: string): string {
  return `${item.host}/${item.owner}/${item.repo}`.toLowerCase() + `:${branch}`;
}
