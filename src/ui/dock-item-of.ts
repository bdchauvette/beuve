import type { UraItemView } from '#contract/ipc-contract.ts';

import type { DockSelectionFacts } from './dock-selection-facts.ts';

/**
 * What the dock's notes under the cursor or in the selection enable in the menus, while the dock
 * has the focus (ADR 0142): a Note command acts on all of them, so it says Restore and Mark as
 * Not Addressed only when every one of them is withdrawn or addressed. Pure.
 */
export function dockItemOf(items: readonly UraItemView[]): DockSelectionFacts | undefined {
  if (items.length === 0) {
    return undefined;
  }
  return {
    count: items.length,
    isAddressed: items.every((item) => item.status.kind === 'addressed'),
    isWithdrawn: items.every((item) => item.status.kind === 'withdrawn'),
  };
}
