import type {
  LocalReviewStateView,
  QueueGroupView,
  ReviewQueueItemView,
  TurnView,
} from '#contract/ipc-contract.ts';

/** A run of queue rows under one heading; `label` is empty when the queue is not grouped. */
export interface QueueGroup {
  readonly id: string;
  readonly label: string;
  readonly items: readonly ReviewQueueItemView[];
}

const turnLabels: Readonly<Record<TurnView, string>> = {
  you: 'Your turn',
  reviewers: 'Reviewers’ turn',
  author: 'Author’s turn',
  unknown: 'Nobody’s turn',
};

const localLabels: Readonly<Record<LocalReviewStateView, string>> = {
  'new-commits': 'New commits since your review',
  partial: 'Partly reviewed',
  opened: 'Opened, not reviewed',
  none: 'Not opened',
  reviewed: 'Reviewed and up to date',
};

const kindLabels = { 'pull-request': 'Pull requests', branch: 'Branches' } as const;

/**
 * The sorted queue items under headings (ADR 0113), keeping their order within each group:
 * by repository (alphabetical), stack (stacks of two or more in the order of their first item,
 * each in stack order, then the rest), turn (yours first), kind (pull requests first) or local
 * review state (new commits first). Groups are in a fixed order, not the items'. Pure.
 */
export function groupQueueItems(
  items: readonly ReviewQueueItemView[],
  group: QueueGroupView,
): QueueGroup[] {
  switch (group) {
    case 'none': {
      return [{ id: 'all', label: '', items }];
    }
    case 'repository': {
      const groups = collect(items, (item) => {
        const name = `${item.owner}/${item.repo}`;
        if (item.host === 'github.com') {
          return { id: name.toLowerCase(), label: name };
        }
        return { id: `${item.host}/${name}`.toLowerCase(), label: `${item.host}/${name}` };
      });
      return groups.toSorted((left, right) => left.id.localeCompare(right.id));
    }
    case 'stack': {
      const groups = collect(items, (item) => {
        if (item.stack === undefined) {
          return { id: '~', label: 'Not stacked' };
        }
        const bottom = items.find((candidate) => candidate.key === item.stack?.id) ?? item;
        return { id: item.stack.id, label: `Stack on ${labelOf(bottom)}` };
      });
      return groups
        .toSorted((left, right) => Number(left.id === '~') - Number(right.id === '~'))
        .map((stack) => {
          if (stack.id === '~') {
            return stack;
          }
          return { ...stack, items: stack.items.toSorted(compareStackPositions) };
        });
    }
    case 'turn': {
      return inOrder(
        collect(items, (item) => fixed(item.attention.turn, turnLabels)),
        turnLabels,
      );
    }
    case 'kind': {
      return inOrder(
        collect(items, (item) => fixed(item.kind, kindLabels)),
        kindLabels,
      );
    }
    case 'local': {
      return inOrder(
        collect(items, (item) => fixed(item.local.state, localLabels)),
        localLabels,
      );
    }
  }
}

/** Where an item goes. */
interface Heading {
  readonly id: string;
  readonly label: string;
}

/** Groups in the order their first item comes. */
function collect(
  items: readonly ReviewQueueItemView[],
  headingOf: (item: ReviewQueueItemView) => Heading,
): QueueGroup[] {
  const groups = new Map<
    string,
    { readonly label: string; readonly items: ReviewQueueItemView[] }
  >();
  for (const item of items) {
    const { id, label } = headingOf(item);
    groups
      .getOrInsertComputed(id, () => {
        return { label, items: [] };
      })
      .items.push(item);
  }
  return groups
    .entries()
    .map(([id, { label, items: grouped }]) => {
      return { id, label, items: grouped };
    })
    .toArray();
}

function fixed<K extends string>(id: K, labels: Readonly<Record<K, string>>): Heading {
  return { id, label: labels[id] };
}

/** Groups in the order of the labels' keys. */
function inOrder(
  groups: readonly QueueGroup[],
  labels: Readonly<Record<string, string>>,
): QueueGroup[] {
  const order = Object.keys(labels);
  return groups.toSorted((left, right) => order.indexOf(left.id) - order.indexOf(right.id));
}

/** Bottom first, each pull request before those based on it. */
function compareStackPositions(left: ReviewQueueItemView, right: ReviewQueueItemView): number {
  return (left.stack?.position ?? 0) - (right.stack?.position ?? 0);
}

/** `#12 Title`, or the branch for a branch. */
function labelOf(item: ReviewQueueItemView): string {
  if (item.number === undefined) {
    return item.branch ?? item.title;
  }
  return `#${String(item.number)} ${item.title}`;
}
