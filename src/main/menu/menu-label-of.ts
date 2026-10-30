import type { CatalogCommand, KeyPlatform } from '#contract/command-catalog.ts';

/** A command's menu label on `platform`: the Linux label, else the menu label, else its title. */
export function menuLabelOf(command: CatalogCommand, platform: KeyPlatform): string {
  return (platform === 'linux' ? command.linuxLabel : undefined) ?? command.label ?? command.title;
}
