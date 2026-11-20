import type { EditUraItemsRequest, UraItemView } from '#contract/ipc-contract.ts';

/** The closed status Withdraw / Restore or Mark as (Not) Addressed toggles. */
type ClosedStatus = 'withdrawn' | 'addressed';

/**
 * What Withdraw / Restore or Mark as (Not) Addressed does to these notes (ADR 0144, 0151): when
 * every one has `status` already, all reopen; otherwise every one that does not have it takes it,
 * whether it was staged or in the other closed status. Nothing to do is `undefined`. Pure.
 */
export function noteStatusChange(
  items: readonly UraItemView[],
  status: ClosedStatus,
): EditUraItemsRequest | undefined {
  if (items.length === 0) {
    return undefined;
  }
  if (items.every((item) => item.status.kind === status)) {
    return { itemIds: items.map((item) => item.id), change: { kind: 'reopen' } };
  }
  const moving = items.filter((item) => item.status.kind !== status);
  return { itemIds: moving.map((item) => item.id), change: { kind: actionFor[status] } };
}

const actionFor = {
  withdrawn: 'withdraw',
  addressed: 'mark-addressed',
} as const satisfies Readonly<Record<ClosedStatus, 'withdraw' | 'mark-addressed'>>;
