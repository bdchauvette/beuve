import { acceleratorsFor } from '#contract/accelerators-for.ts';
import type { CatalogCommand, KeyPlatform, MenuPlace, TopMenu } from '#contract/command-catalog.ts';

import { joinMenuSections } from './join-menu-sections.ts';
import type { MenuTemplateItem } from './menu-template-item.ts';
import { menuLabelOf } from './menu-label-of.ts';
import { placeOfCommand } from './place-of-command.ts';

export interface MenuTemplateOptions {
  readonly catalog: readonly CatalogCommand[];
  readonly platform: KeyPlatform;
}

const letter = /^[\p{L}\p{N}]$/u;

/** A catalog command and where the menu bar shows it. */
interface PlacedCommand {
  readonly command: CatalogCommand;
  readonly place: MenuPlace;
}

/** The accelerators of the roles both platforms show. */
const roleAccelerators = {
  mac: {
    undo: 'Cmd+Z',
    redo: 'Shift+Cmd+Z',
    cut: 'Cmd+X',
    copy: 'Cmd+C',
    paste: 'Cmd+V',
    selectAll: 'Cmd+A',
    resetZoom: 'Cmd+0',
    zoomIn: 'Cmd+Plus',
    zoomOut: 'Cmd+-',
    togglefullscreen: 'Ctrl+Cmd+F',
    close: 'Cmd+W',
  },
  linux: {
    undo: 'Ctrl+Z',
    redo: 'Ctrl+Shift+Z',
    cut: 'Ctrl+X',
    copy: 'Ctrl+C',
    paste: 'Ctrl+V',
    selectAll: 'Ctrl+A',
    resetZoom: 'Ctrl+0',
    zoomIn: 'Ctrl+Plus',
    zoomOut: 'Ctrl+-',
    togglefullscreen: 'F11',
    close: 'Ctrl+W',
  },
} as const satisfies Readonly<Record<KeyPlatform, Readonly<Record<string, string>>>>;

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
  const roles = roleItemsFor(platform);
  const placed = catalog
    .map((command) => {
      return { command, place: placeOfCommand(command, platform) };
    })
    .filter((entry): entry is PlacedCommand => {
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
      if (!isMac) {
        return { label: topLabels[menu], submenu: withMnemonics(submenu) };
      }
      if (menu === 'window') {
        return { role: 'windowMenu' };
      }
      return {
        label: topLabels[menu].replace('&', ''),
        ...(menu === 'help' && { role: 'help' }),
        submenu,
      };
    });
  return menus;
}

/** One group's items; a submenu gathers the group's commands that name it, at its first one. */
function itemsOf(entries: readonly PlacedCommand[], platform: KeyPlatform): MenuTemplateItem[] {
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
    let submenu: MenuTemplateItem[] | undefined;
    if (item.submenu !== undefined) {
      submenu = withMnemonics(item.submenu);
    }
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
): Partial<Record<TopMenu, Readonly<Record<number, readonly MenuTemplateItem[]>>>> {
  const keys = roleAccelerators[platform];
  const help: Record<number, readonly MenuTemplateItem[]> = {
    3: [
      {
        label: 'Troubleshooting',
        // An empty accelerator, because a role without one takes Electron's default
        // (Ctrl+Shift+I, which is Show Control Flow on Linux).
        submenu: [{ role: 'toggleDevTools', label: 'Toggle Developer Tools', accelerator: '' }],
      },
    ],
  };
  const edit: Record<number, readonly MenuTemplateItem[]> = {
    0: [
      { role: 'undo', label: 'Undo', accelerator: keys.undo },
      { role: 'redo', label: 'Redo', accelerator: keys.redo },
    ],
    1: [
      { role: 'cut', label: 'Cut', accelerator: keys.cut },
      { role: 'copy', label: 'Copy', accelerator: keys.copy },
      { role: 'paste', label: 'Paste', accelerator: keys.paste },
      { role: 'selectAll', label: 'Select All', accelerator: keys.selectAll },
    ],
  };
  const view: Record<number, readonly MenuTemplateItem[]> = {
    5: [
      { role: 'resetZoom', label: 'Actual Size', accelerator: keys.resetZoom },
      { role: 'zoomIn', label: 'Zoom In', accelerator: keys.zoomIn },
      { role: 'zoomOut', label: 'Zoom Out', accelerator: keys.zoomOut },
    ],
    6: [
      { role: 'togglefullscreen', label: 'Toggle Full Screen', accelerator: keys.togglefullscreen },
    ],
  };
  const closeWindow: MenuTemplateItem = {
    role: 'close',
    label: 'Close Window',
    accelerator: keys.close,
  };
  if (platform === 'mac') {
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
      help,
    };
  }
  return {
    file: { 2: [closeWindow], 9: [{ role: 'quit', label: 'Quit', accelerator: 'Ctrl+Q' }] },
    edit,
    view,
    window: { 0: [{ role: 'minimize', label: 'Minimize' }] },
    help,
  };
}
