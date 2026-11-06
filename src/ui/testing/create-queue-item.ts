import type { ReviewQueueItemView } from '#contract/ipc-contract.ts';

/** Fields to set; `undefined` leaves an optional one out. */
export type QueueItemOverrides = {
  readonly [K in keyof ReviewQueueItemView]?: ReviewQueueItemView[K] | undefined;
};

/**
 * A review queue item: an open pull request #1 in `o/r`, requested of the viewer directly. One
 * whose `reasons` leave out `requested` has no `request`.
 */
export function createQueueItem(overrides: QueueItemOverrides = {}): ReviewQueueItemView {
  const number = overrides.number ?? 1;
  const item = {
    key: `github.com/o/r#${String(number)}`,
    kind: 'pull-request',
    forge: 'github',
    host: 'github.com',
    owner: 'o',
    repo: 'r',
    number,
    title: `Change ${String(number)}`,
    author: 'octocat',
    isDraft: false,
    htmlUrl: `https://github.com/o/r/pull/${String(number)}`,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-02T00:00:00Z',
    waitingSince: '2026-10-02T00:00:00Z',
    waitingSinceSource: 'requested',
    attention: { turn: 'you', reasons: ['a review was requested from you'] },
    reasons: ['requested'],
    request: 'direct',
    local: { state: 'none' },
    ...overrides,
  };
  const isRequested = (overrides.reasons ?? ['requested']).includes('requested');
  return Object.fromEntries(
    Object.entries(item).filter(([name, value]) => {
      return value !== undefined && (isRequested || name !== 'request');
    }),
  ) as unknown as ReviewQueueItemView;
}
