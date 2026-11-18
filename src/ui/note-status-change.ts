import type { EditUraItemsRequest, UraItemView } from '#contract/ipc-contract.ts';

/**
 * What Withdraw / Restore or Mark as (Not) Addressed does to these notes (ADR 0143): when every
 * one has `status` already, all go back to staged; otherwise the staged ones take `status`, and
 * the others stay as they are (a withdrawn note is restored before it can be addressed). Nothing
 * to do is `undefined`. Pure.
 */
export function noteStatusChange(
  items: readonly UraItemView[],
  status: 'withdrawn' | 'addressed',
): EditUraItemsRequest | undefined {
  if (items.length === 0) {
    return undefined;
  }
  if (items.every((item) => item.status.kind === status)) {
    return {
      itemIds: items.map((item) => item.id),
      change: { kind: 'status', to: 'staged' },
    };
  }
  const staged = items.filter((item) => item.status.kind === 'staged');
  if (staged.length === 0) {
    return undefined;
  }
  return { itemIds: staged.map((item) => item.id), change: { kind: 'status', to: status } };
}
