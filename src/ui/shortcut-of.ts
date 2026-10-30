import { acceleratorsFor } from '#contract/accelerators-for.ts';
import { commandCatalog } from '#contract/command-catalog.ts';
import type { CommandId, KeyPlatform } from '#contract/command-catalog.ts';

import { displayAccelerator } from './display-accelerator.ts';

/** A catalog command's first shortcut as `platform` writes it, for tooltips; `''` without one. Pure. */
export function shortcutOf(id: CommandId, platform: KeyPlatform): string {
  const command = commandCatalog.find((candidate) => candidate.id === id);
  const [key] = command === undefined ? [] : acceleratorsFor(command, platform);
  return key === undefined ? '' : displayAccelerator(key, platform);
}
