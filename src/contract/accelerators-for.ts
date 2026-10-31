import type { CatalogCommand, KeyPlatform } from './command-catalog.ts';

/** A command's Electron accelerators on `platform`, the menu's own first; empty without keys. */
export function acceleratorsFor(command: CatalogCommand, platform: KeyPlatform): readonly string[] {
  const keys = command.keys;
  if (keys === undefined) {
    return [];
  }
  const primary = platform === 'mac' ? keys.mac : keys.linux;
  const alternates = (platform === 'mac' ? keys.macAlt : keys.linuxAlt) ?? [];
  if (primary === undefined) {
    return alternates;
  }
  return [primary, ...alternates];
}
