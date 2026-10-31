import { acceleratorsFor } from '#contract/accelerators-for.ts';
import type { CatalogCommand, KeyPlatform, MenuPlace, TopMenu } from '#contract/command-catalog.ts';

import { joinMenuSections } from './join-menu-sections.ts';
import type { MenuTemplateItem } from './menu-template-item.ts';
import { menuLabelOf } from './menu-label-of.ts';
import { placeOfCommand } from './place-of-command.ts';

export interface MenuTemplateOptions {
  readonly catalog: readonly CatalogCommand[];
  readonly platform: KeyPlatform;
  /** Development builds add Toggle Developer Tools to View. */
  readonly isPackaged: boolean;
}

const letter = /^[\p{L}\p{N}]$/u;

const topMenus: readonly TopMenu[] = [
  'app',
  'file',
  'edit',
  'view',
  'go',
  'review',
  'chat',
  'window',
  'help',
];

const topLabels: Readonly<Record<TopMenu, string>> = {
  app: 'beuve',
  file: '&File',
  edit: '&Edit',
  view: '&View',
  go: '&Go',
  review: '&Review',
  chat: '&Chat',
  window: '&Window',
  help: '&Help',
};

/**
 * The menu bar (ADR 0068) for `platform`, from the command catalog: on macOS the app menu and
 * File, Edit, View, Go, Review, Chat, Window and Help; on Linux the same without the app menu
 * (About in Help, Preferences in Edit, Quit in File) and with `&` mnemonics, unique per menu.
 * Items sort by group, then catalog order, with separators between groups; a command's first
 * accelerator is shown, the others are hidden items that still work. Pure.
 */
export function menuTemplateFrom(options: MenuTemplateOptions): readonly MenuTemplateItem[] {
  const { catalog, platform } = options;
  const isMac = platform === 'mac';
  const roles = roleItemsFor(platform, options.isPackaged);
  const placed = catalog
    .map((command) => {
      return { command, place: placeOfCommand(command, platform) };
    })
    .filter((entry): entry is { command: CatalogCommand; place: MenuPlace } => {
      return entry.place !== undefined;
    });
  const menus = topMenus
    .filter((menu) => isMac || menu !== 'app')
    .map((menu): MenuTemplateItem => {
      const extra = roles[menu] ?? {};
      const groups = new Set([
        ...Object.keys(extra).map(Number),
        ...placed.filter(({ place }) => place.menu === menu).map(({ place }) => place.group),
      ]);
      const sections = [...groups]
        .toSorted((left, right) => left - right)
        .map((group) => {
          return [
            ...(extra[group] ?? []),
            ...itemsOf(
              placed.filter(({ place }) => place.menu === menu && place.group === group),
              platform,
            ),
          ];
        });
      const submenu = joinMenuSections(sections);
      const label = isMac ? topLabels[menu].replace('&', '') : topLabels[menu];
      if (isMac && menu === 'window') {
        return { role: 'windowMenu' };
      }
      return {
        label,
        ...(isMac && menu === 'help' && { role: 'help' }),
        submenu: isMac ? submenu : withMnemonics(submenu),
      };
    });
  return menus;
}

/** One group's items; a submenu gathers the group's commands that name it, at its first one. */
function itemsOf(
  entries: readonly { readonly command: CatalogCommand; readonly place: MenuPlace }[],
  platform: KeyPlatform,
): MenuTemplateItem[] {
  const items: MenuTemplateItem[] = [];
  const seen = new Set<string>();
  for (const { command, place } of entries) {
    if (place.submenu === undefined) {
      items.push(...commandItems(command, platform));
      continue;
    }
    if (seen.has(place.submenu)) {
      continue;
    }
    seen.add(place.submenu);
    const members = entries.filter((entry) => entry.place.submenu === place.submenu);
    const subgroups = [...new Set(members.map((entry) => entry.place.subgroup ?? 0))].toSorted(
      (left, right) => {
        return left - right;
      },
    );
    items.push({
      label: place.submenu,
      submenu: joinMenuSections(
        subgroups.map((subgroup) => {
          return members
            .filter((entry) => (entry.place.subgroup ?? 0) === subgroup)
            .flatMap((entry) => commandItems(entry.command, platform));
        }),
      ),
    });
  }
  return items;
}

/** The visible item with the first accelerator, then a hidden item per alternate. */
function commandItems(command: CatalogCommand, platform: KeyPlatform): MenuTemplateItem[] {
  const [primary, ...alternates] = acceleratorsFor(command, platform);
  const label = menuLabelOf(command, platform);
  return [
    {
      id: command.id,
      label,
      ...(command.toggle !== undefined && { type: command.toggle }),
      ...(primary !== undefined && { accelerator: primary }),
    },
    ...alternates.map((accelerator, index): MenuTemplateItem => {
      return {
        id: `${command.id}~${String(index + 1)}`,
        label,
        accelerator,
        visible: false,
      };
    }),
  ];
}

/**
 * Linux access keys: `&` before the first letter not yet taken in the same menu, word starts
 * first; a literal `&` is doubled. Hidden items and separators take none.
 */
function withMnemonics(items: readonly MenuTemplateItem[]): MenuTemplateItem[] {
  const taken = new Set<string>();
  return items.map((item) => {
    const submenu = item.submenu === undefined ? undefined : withMnemonics(item.submenu);
    if (item.label === undefined || item.visible === false) {
      if (submenu === undefined) {
        return item;
      }
      return { ...item, submenu };
    }
    const label = mnemonicLabel(item.label, taken);
    return { ...item, label, ...(submenu !== undefined && { submenu }) };
  });
}

function mnemonicLabel(label: string, taken: Set<string>): string {
  // Menu labels are short Latin text; code points are enough to pick an access key.
  // eslint-disable-next-line @typescript-eslint/no-misused-spread -- see above.
  const characters = [...label];
  const indexes = characters.map((_character, index) => index);
  const starts = indexes.filter((index) => {
    return (
      isLetter(characters[index] ?? '') && (index === 0 || !isLetter(characters[index - 1] ?? ''))
    );
  });
  const rest = indexes.filter((index) => {
    return isLetter(characters[index] ?? '') && !starts.includes(index);
  });
  const chosen = [...starts, ...rest].find((index) => {
    return !taken.has((characters[index] ?? '').toLowerCase());
  });
  const escaped = characters.map((character) => {
    if (character === '&') {
      return '&&';
    }
    return character;
  });
  if (chosen === undefined) {
    return escaped.join('');
  }
  taken.add((characters[chosen] ?? '').toLowerCase());
  return [...escaped.slice(0, chosen), '&', ...escaped.slice(chosen)].join('');
}

function isLetter(character: string): boolean {
  return letter.test(character);
}

/** The roles each menu holds per group, before that group's catalog commands. */
function roleItemsFor(
  platform: KeyPlatform,
  isPackaged: boolean,
): Partial<Record<TopMenu, Readonly<Record<number, readonly MenuTemplateItem[]>>>> {
  const isMac = platform === 'mac';
  const developer: Record<number, readonly MenuTemplateItem[]> = isPackaged
    ? {}
    : {
        8: [
          {
            role: 'toggleDevTools',
            label: 'Toggle Developer Tools',
            accelerator: isMac ? 'Alt+Cmd+J' : 'Ctrl+Shift+J',
          },
        ],
      };
  const edit: Record<number, readonly MenuTemplateItem[]> = {
    0: [
      { role: 'undo', label: 'Undo', accelerator: isMac ? 'Cmd+Z' : 'Ctrl+Z' },
      { role: 'redo', label: 'Redo', accelerator: isMac ? 'Shift+Cmd+Z' : 'Ctrl+Shift+Z' },
    ],
    1: [
      { role: 'cut', label: 'Cut', accelerator: isMac ? 'Cmd+X' : 'Ctrl+X' },
      { role: 'copy', label: 'Copy', accelerator: isMac ? 'Cmd+C' : 'Ctrl+C' },
      { role: 'paste', label: 'Paste', accelerator: isMac ? 'Cmd+V' : 'Ctrl+V' },
      { role: 'selectAll', label: 'Select All', accelerator: isMac ? 'Cmd+A' : 'Ctrl+A' },
    ],
  };
  const view: Record<number, readonly MenuTemplateItem[]> = {
    5: [
      { role: 'resetZoom', label: 'Actual Size', accelerator: isMac ? 'Cmd+0' : 'Ctrl+0' },
      { role: 'zoomIn', label: 'Zoom In', accelerator: isMac ? 'Cmd+Plus' : 'Ctrl+Plus' },
      { role: 'zoomOut', label: 'Zoom Out', accelerator: isMac ? 'Cmd+-' : 'Ctrl+-' },
    ],
    6: [
      {
        role: 'togglefullscreen',
        label: 'Toggle Full Screen',
        accelerator: isMac ? 'Ctrl+Cmd+F' : 'F11',
      },
    ],
    ...developer,
  };
  const closeWindow: MenuTemplateItem = {
    role: 'close',
    label: 'Close Window',
    accelerator: isMac ? 'Cmd+W' : 'Ctrl+W',
  };
  if (isMac) {
    return {
      app: {
        2: [{ role: 'services', label: 'Services' }],
        3: [
          { role: 'hide', label: 'Hide beuve', accelerator: 'Cmd+H' },
          { role: 'hideOthers', label: 'Hide Others', accelerator: 'Alt+Cmd+H' },
          { role: 'unhide', label: 'Show All' },
        ],
        4: [{ role: 'quit', label: 'Quit beuve', accelerator: 'Cmd+Q' }],
      },
      file: { 2: [closeWindow] },
      edit,
      view,
    };
  }
  return {
    file: { 2: [closeWindow], 9: [{ role: 'quit', label: 'Quit', accelerator: 'Ctrl+Q' }] },
    edit,
    view,
    window: { 0: [{ role: 'minimize', label: 'Minimize' }] },
  };
}
