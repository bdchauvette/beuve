import type { QueueFiltersView, ReviewQueueItemView } from '#contract/ipc-contract.ts';

const whitespace = /\s+/u;

/** The saved filters and the free text typed over them (not saved). */
export interface QueueFilterInput {
  readonly filters: QueueFiltersView;
  readonly text: string;
}

/**
 * The queue items the filters let through (ADR 0113). An empty list in a filter allows
 * everything. Unless `showWaitingOnOthers`, the viewer's own pull requests that are someone
 * else's turn are hidden; a review request is never hidden by that, so under the default filters
 * every requested review shows, whatever its turn, draft state or CI. The text matches the title,
 * repository, number, branch and author, ignoring case. Pure.
 */
export function filterQueueItems(
  items: readonly ReviewQueueItemView[],
  { filters, text }: QueueFilterInput,
): ReviewQueueItemView[] {
  const words = text
    .toLowerCase()
    .split(whitespace)
    .filter((word) => word !== '');
  const repositories = new Set(filters.repositories.map((name) => name.toLowerCase()));
  return items.filter((item) => {
    return (
      isAllowed(filters.kinds, item.kind) &&
      (repositories.size === 0 || repositories.has(repositoryOf(item))) &&
      isAllowed(filters.authors, item.author) &&
      (filters.request === 'any' || item.request === filters.request) &&
      !(filters.hideDrafts && item.isDraft) &&
      isCiAllowed(filters, item) &&
      isAllowed(filters.turns, item.attention.turn) &&
      isAllowed(filters.local, item.local.state) &&
      (filters.showWaitingOnOthers || !isWaitingOnOthers(item)) &&
      words.every((word) => haystackOf(item).includes(word))
    );
  });
}

/** `host/owner/repo`, lowercase, as the repository filter names it. */
function repositoryOf(item: ReviewQueueItemView): string {
  return `${item.host}/${item.owner}/${item.repo}`.toLowerCase();
}

function isAllowed<T>(allowed: readonly T[], value: T): boolean {
  return allowed.length === 0 || allowed.includes(value);
}

/** An item without CI (none yet, or none at all) passes only an empty CI filter. */
function isCiAllowed(filters: QueueFiltersView, item: ReviewQueueItemView): boolean {
  if (filters.ci.length === 0) {
    return true;
  }
  const overall = item.ci?.overall;
  return (
    (overall === 'failure' || overall === 'pending' || overall === 'success') &&
    filters.ci.includes(overall)
  );
}

/** The viewer's own pull request, not requested of them, waiting on someone else. */
function isWaitingOnOthers(item: ReviewQueueItemView): boolean {
  return (
    item.reasons.includes('authored') &&
    !item.reasons.includes('requested') &&
    item.attention.turn !== 'you'
  );
}

function haystackOf(item: ReviewQueueItemView): string {
  const number = item.number ?? '';
  return [
    item.title,
    `${item.owner}/${item.repo}`,
    `#${String(number)}`,
    item.branch ?? '',
    item.author,
  ]
    .join(' ')
    .toLowerCase();
}
