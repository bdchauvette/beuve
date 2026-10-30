import type { CatalogCommand, WindowKind } from '#contract/command-catalog.ts';
import type { MenuStateRequest } from '#contract/ipc-contract.ts';

/** Whether one menu item can be chosen, and whether its toggle shows checked. */
export interface MenuItemState {
  readonly enabled: boolean;
  readonly checked: boolean;
}

/**
 * Each catalog command's menu item state for a window of `kind` that reported `state` (ADR 0068):
 * enabled when the command runs in that kind of window and every condition of its `when` holds,
 * except a `textConflict` command while a text field has focus, so the field keeps its own key.
 * Main runs `main` commands whatever the window. Pure.
 */
export function menuItemStatesFrom(
  catalog: readonly CatalogCommand[],
  kind: WindowKind,
  state: MenuStateRequest,
): ReadonlyMap<string, MenuItemState> {
  const conditions = new Set<string>(state.conditions);
  const checked = new Set<string>(state.checked);
  const isTyping = conditions.has('text-focus');
  return new Map(
    catalog.map((command) => [
      command.id,
      {
        enabled:
          command.windows.includes(kind) &&
          (command.when ?? []).every((condition) => conditions.has(condition)) &&
          !(isTyping && command.textConflict === true),
        checked: command.toggle !== undefined && checked.has(command.id),
      },
    ]),
  );
}
