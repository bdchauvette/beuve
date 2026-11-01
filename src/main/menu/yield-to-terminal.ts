import type { CatalogCommand, KeyPlatform, MenuCondition } from '#contract/command-catalog.ts';

import type { MenuItemState } from './menu-item-states-from.ts';

/** What decides whether keyed commands give way to a terminal. */
export interface TerminalYieldOptions {
  readonly catalog: readonly CatalogCommand[];
  readonly conditions: readonly MenuCondition[];
  readonly platform: KeyPlatform;
}

/**
 * While a terminal has the keyboard on Linux, every keyed command but those that
 * `keepsInTerminal` is disabled (ADR 0095), so Ctrl-D, Ctrl-R and the other shell chords reach the
 * shell. Disabled items pass their key on. macOS chords use Cmd, which a terminal never needs, so
 * nothing yields there. Pure.
 */
export function yieldToTerminal(
  states: ReadonlyMap<string, MenuItemState>,
  options: TerminalYieldOptions,
): ReadonlyMap<string, MenuItemState> {
  if (options.platform !== 'linux' || !options.conditions.includes('terminal-focus')) {
    return states;
  }
  const yielding = new Set(
    options.catalog
      .filter((command) => {
        return (
          command.keepsInTerminal !== true &&
          (command.keys?.linux !== undefined || (command.keys?.linuxAlt?.length ?? 0) > 0)
        );
      })
      .map((command) => command.id),
  );
  return new Map(
    Array.from(states, ([id, state]) => {
      if (yielding.has(id)) {
        return [id, { ...state, enabled: false }];
      }
      return [id, state];
    }),
  );
}
