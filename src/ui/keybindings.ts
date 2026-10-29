import { commandRegistry } from './command-registry.ts';

export interface Keybinding {
  readonly keys: readonly string[];
  readonly action: string;
  readonly scope: string;
  readonly available: boolean;
}

/** The keyboard map (spec 5A and the shell's own keys), read from the command registry. */
export const keybindings: readonly Keybinding[] = Object.freeze(
  commandRegistry
    .filter((command) => command.keys.length > 0)
    .map(({ keys, title, scope, available }) => ({ keys, action: title, scope, available })),
);
