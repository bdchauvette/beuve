import { acceleratorsFor } from '#contract/accelerators-for.ts';
import type { CatalogCommand, KeyPlatform, TopMenu } from '#contract/command-catalog.ts';

import { displayAccelerator } from './display-accelerator.ts';

/** One heading of the Keyboard Shortcuts window and its rows. */
export interface ShortcutSection {
  readonly title: string;
  readonly rows: readonly { readonly title: string; readonly keys: readonly string[] }[];
}

const menuTitles: readonly (readonly [TopMenu, string])[] = [
  ['app', 'beuve'],
  ['file', 'File'],
  ['edit', 'Edit'],
  ['view', 'View'],
  ['go', 'Go'],
  ['review', 'Review'],
  ['chat', 'Chat'],
  ['help', 'Help'],
];

/**
 * Help ▸ Keyboard Shortcuts (ADR 0068), generated from the catalog: every command with a key on
 * `platform`, under the menu that holds it (Linux has no app menu), then the keys that work only
 * where the focus is, by area. Pure.
 */
export function shortcutSectionsFor(
  catalog: readonly CatalogCommand[],
  platform: KeyPlatform,
): ShortcutSection[] {
  const menuOf = (command: CatalogCommand): TopMenu | undefined => {
    if (platform === 'linux') {
      return (command.linuxMenu ?? command.menu)?.menu;
    }
    return command.menu?.menu;
  };
  const keyed = catalog
    .map((command) => {
      return {
        command,
        keys: acceleratorsFor(command, platform).map((key) => displayAccelerator(key, platform)),
      };
    })
    .filter(({ keys }) => keys.length > 0);
  const menus = menuTitles.map(([menu, title]): ShortcutSection => {
    return {
      title,
      rows: keyed
        .filter(({ command }) => menuOf(command) === menu)
        .map(({ command, keys }) => {
          return { title: shortcutTitleOf(command), keys };
        }),
    };
  });
  const areas = [
    ...new Set(
      catalog.flatMap((command) => {
        return command.inPlace?.area ?? [];
      }),
    ),
  ];
  const inPlace = areas.map((area): ShortcutSection => {
    return {
      title: area,
      rows: catalog
        .filter((command) => command.inPlace?.area === area)
        .map((command) => {
          return {
            title: shortcutTitleOf(command),
            keys: inPlaceKeysOf(command, platform).map((key) => displayAccelerator(key, platform)),
          };
        }),
    };
  });
  return [...menus, ...inPlace].filter((section) => section.rows.length > 0);
}

/** A command's in-place keys on `platform`. */
function inPlaceKeysOf(command: CatalogCommand, platform: KeyPlatform): readonly string[] {
  if (platform === 'linux' && command.inPlace?.linuxKeys !== undefined) {
    return command.inPlace.linuxKeys;
  }
  return command.inPlace?.keys ?? [];
}

/** The title, or both names of a command whose name follows the state (ADR 0143). */
function shortcutTitleOf(command: CatalogCommand): string {
  if (command.checkedNames === undefined) {
    return command.title;
  }
  return `${command.title} or ${command.checkedNames.title}`;
}
