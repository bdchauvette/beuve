import type { UraItemView } from '#contract/ipc-contract.ts';

import type { MenuStateInput } from './menu-state-from.ts';

/** What the dock's cursor item enables in the menus, while the dock has the focus. */
export function dockItemOf(item: UraItemView | undefined): MenuStateInput['dockItem'] {
  if (item === undefined) {
    return undefined;
  }
  return { isAddressed: item.status.kind === 'addressed' };
}
