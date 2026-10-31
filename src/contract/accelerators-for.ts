import type { CatalogCommand, CommandKeys, KeyPlatform } from './command-catalog.ts';

/** A command's Electron accelerators on `platform`, the menu's own first; empty without keys. */
export function acceleratorsFor(command: CatalogCommand, platform: KeyPlatform): readonly string[] {
  const keys = command.keys;
  if (keys === undefined) {
    return [];
  }
  const { primary, alternates } = platformKeys(keys, platform);
  if (primary === undefined) {
    return alternates;
  }
  return [primary, ...alternates];
}

/** One platform's half of a command's keys. */
interface PlatformKeys {
  readonly primary: string | undefined;
  readonly alternates: readonly string[];
}

function platformKeys(keys: CommandKeys, platform: KeyPlatform): PlatformKeys {
  if (platform === 'mac') {
    return { primary: keys.mac, alternates: keys.macAlt ?? [] };
  }
  return { primary: keys.linux, alternates: keys.linuxAlt ?? [] };
}
