import type { CatalogCommand, KeyPlatform, MenuPlace } from '#contract/command-catalog.ts';

/** Where a command sits in the menu bar on `platform`; `undefined` when it has no menu item. */
export function placeOfCommand(
  command: CatalogCommand,
  platform: KeyPlatform,
): MenuPlace | undefined {
  return platform === 'linux' ? (command.linuxMenu ?? command.menu) : command.menu;
}
