import type { UraItemView } from '#contract/ipc-contract.ts';

import type { DockSelectionFacts } from './dock-selection-facts.ts';

/**
 * What the dock's notes under the cursor or in the selection enable in the menus, while the dock
 * has the focus (ADR 0144): a Note command acts on all of them, so it says Restore, Mark as Not
 * Addressed or Mark as Not Blocking only when every one of them is withdrawn, addressed or
 * blocking, and Status and Label check the status and label they all share. Pure.
 */
export function dockItemOf(items: readonly UraItemView[]): DockSelectionFacts | undefined {
  if (items.length === 0) {
    return undefined;
  }
  const [first] = items;
  const status = first?.status.kind;
  const severity = first?.severity;
  return {
    count: items.length,
    isAddressed: items.every((item) => item.status.kind === 'addressed'),
    isWithdrawn: items.every((item) => item.status.kind === 'withdrawn'),
    isBlocking: items.every((item) => item.blocking),
    ...(items.every((item) => item.status.kind === status) && { status }),
    ...(items.every((item) => item.severity === severity) && { severity }),
  };
}
