import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { acceleratorsFor } from '#contract/accelerators-for.ts';
import { commandCatalog } from '#contract/command-catalog.ts';
import type { CatalogCommand, KeyPlatform } from '#contract/command-catalog.ts';
import { contextMenuLayouts } from '#contract/context-menu-layouts.ts';
import type { ContextMenuLayout, ContextSubmenu } from '#contract/context-menu-layouts.ts';

import { contextMenuTemplateFrom } from './context-menu-template-from.ts';
import { menuTemplateFrom } from './menu-template-from.ts';
import type { MenuTemplateItem } from './menu-template-item.ts';
import { placeOfCommand } from './place-of-command.ts';

describe('menuTemplateFrom', () => {
  test.for(['mac', 'linux'] as const)('lays out the %s menu bar', (platform, { expect }) => {
    expect(menuTemplateFrom({ catalog: commandCatalog, platform })).toMatchSnapshot();
  });

  test('has the app menu on macOS only, and mnemonics on Linux', ({ expect }) => {
    expect(topLabels('mac')).toStrictEqual([
      'beuve',
      'File',
      'Edit',
      'View',
      'Navigate',
      'Analyze',
      'Review',
      'Note',
      'Chat',
      'windowMenu',
      'Help',
    ]);
    expect(topLabels('linux')).toStrictEqual([
      '&File',
      '&Edit',
      '&View',
      '&Navigate',
      '&Analyze',
      '&Review',
      'N&ote',
      '&Chat',
      '&Window',
      '&Help',
    ]);
  });

  test.for(['mac', 'linux'] as const)(
    'gives every %s command with a key exactly one menu item',
    (platform, { expect }) => {
      const items = flatten(menuTemplateFrom({ catalog: commandCatalog, platform }));
      const keyed = commandCatalog.filter((command) => {
        return acceleratorsFor(command, platform).length > 0;
      });
      expect(
        keyed.filter((command) => placeOfCommand(command, platform) === undefined),
      ).toStrictEqual([]);
      const placed = commandCatalog.filter((command) => {
        return placeOfCommand(command, platform) !== undefined;
      });
      for (const command of placed) {
        expect(items.filter((item) => item.id === command.id)).toHaveLength(1);
      }
    },
  );

  test.for(['mac', 'linux'] as const)(
    'uses no %s accelerator twice and never a bare key (an empty one is no key)',
    (platform, { expect }) => {
      const accelerators = flatten(menuTemplateFrom({ catalog: commandCatalog, platform }))
        .map((item) => item.accelerator)
        .filter((key) => key !== undefined)
        .filter((key) => key !== '')
        .map((key) => normalized(key));
      expect(
        accelerators.filter((key, index) => accelerators.indexOf(key) !== index),
      ).toStrictEqual([]);
      expect(accelerators.filter((key) => !isChord(key))).toStrictEqual([]);
    },
  );

  test('takes no shortcut macOS or the Linux desktops reserve', ({ expect }) => {
    const macReserved = new Set(
      [
        'Cmd+Q',
        'Cmd+W',
        'Cmd+H',
        'Alt+Cmd+H',
        'Cmd+M',
        'Alt+Cmd+M',
        'Cmd+Space',
        'Ctrl+Space',
        'Cmd+Tab',
        'Cmd+`',
        'Shift+Cmd+3',
        'Shift+Cmd+4',
        'Shift+Cmd+5',
        'Ctrl+Cmd+Q',
        'Alt+Cmd+Esc',
        'Alt+Cmd+D',
        'Shift+Cmd+/',
        'Cmd+?',
      ].map((key) => normalized(key)),
    );
    expect(catalogKeys('mac').filter((key) => macReserved.has(key))).toStrictEqual([]);
    expect(catalogKeys('linux').filter((key) => isLinuxReserved(key))).toStrictEqual([]);
  });

  test('gives unique Linux access keys in every menu', ({ expect }) => {
    const menus = menuTemplateFrom({
      catalog: commandCatalog,
      platform: 'linux',
    });
    const clashes: string[] = [];
    const check = (items: readonly MenuTemplateItem[]): void => {
      const keys = items
        .flatMap((item) => {
          if (item.visible === false) {
            return [];
          }
          return [item.label ?? '', item.checkedLabel ?? ''];
        })
        .map((label) => /&([^&])/u.exec(label.replaceAll('&&', ''))?.[1])
        .filter((key) => key !== undefined)
        .map((key) => key.toLowerCase());
      clashes.push(...keys.filter((key, index) => keys.indexOf(key) !== index));
      for (const item of items) {
        check(item.submenu ?? []);
      }
    };
    check(menus);
    expect(clashes).toStrictEqual([]);
    expect(flatten(menus).find((item) => item.id === 'sidebar-overview')?.label).toBe('&Overview');
  });

  test('escapes a literal ampersand in a label on Linux', ({ expect }) => {
    const catalog: readonly CatalogCommand[] = [
      { ...command('fish', { menu: 'navigate', group: 0 }), title: 'Fish & Chips' },
    ];
    const items = flatten(menuTemplateFrom({ catalog, platform: 'linux' }));
    expect(items.find((item) => item.id === 'fish')?.label).toBe('&Fish && Chips');
  });

  test.for(['mac', 'linux'] as const)(
    'gives a %s command whose name follows the state both labels, and no check mark',
    (platform, { expect }) => {
      const items = flatten(menuTemplateFrom({ catalog: commandCatalog, platform }));
      const blocking = items.find((item) => item.id === 'dock-blocking');
      expect([plain(blocking?.label), plain(blocking?.checkedLabel)]).toStrictEqual([
        'Mark as Blocking',
        'Mark as Not Blocking',
      ]);
      expect(blocking?.type).toBeUndefined();
    },
  );

  test('never gives a command checked names and a check mark', ({ expect }) => {
    expect(
      commandCatalog
        .filter((entry) => entry.checkedNames !== undefined && entry.toggle !== undefined)
        .map((entry) => entry.id),
    ).toStrictEqual([]);
  });

  test('carries the icons the catalog names', ({ expect }) => {
    const items = flatten(menuTemplateFrom({ catalog: commandCatalog, platform: 'mac' }));
    expect(
      items
        .filter((item) => item.icon !== undefined)
        .map((item) => {
          return [item.id, item.icon];
        }),
    ).toStrictEqual([
      ['dock-move-up', 'arrow-up'],
      ['dock-move-down', 'arrow-down'],
    ]);
  });

  test('hides alternate keys behind the visible item', ({ expect }) => {
    const items = flatten(menuTemplateFrom({ catalog: commandCatalog, platform: 'mac' }));
    expect(items.filter((item) => item.id?.startsWith('next-hunk') === true)).toStrictEqual([
      { id: 'next-hunk', label: 'Next Change', accelerator: 'Cmd+Down' },
      { id: 'next-hunk~1', label: 'Next Change', accelerator: 'F7', visible: false },
    ]);
  });

  test.for(['mac', 'linux'] as const)(
    'puts the log file, the reset and developer tools in the %s Help › Troubleshooting',
    (platform, { expect }) => {
      const help = menuTemplateFrom({ catalog: commandCatalog, platform }).at(-1);
      const troubleshooting = help?.submenu?.find((item) => {
        return item.label?.replace('&', '') === 'Troubleshooting';
      });
      expect(
        troubleshooting?.submenu?.map((item) => item.id ?? item.role ?? item.type),
      ).toStrictEqual(['show-log', 'reset-database', 'separator', 'toggleDevTools']);
      expect(troubleshooting?.submenu?.at(-1)?.accelerator).toBe('');
    },
  );

  test('sorts by group with separators, and builds submenus where they first appear', ({
    expect,
  }) => {
    const catalog: readonly CatalogCommand[] = [
      command('b', { menu: 'navigate', group: 1 }),
      command('a', { menu: 'navigate', group: 0 }),
      command('c', { menu: 'navigate', group: 1, submenu: 'More' }),
      command('d', { menu: 'navigate', group: 1, submenu: 'More', subgroup: 2 }),
    ];
    const go = menuTemplateFrom({ catalog, platform: 'mac' }).find((item) => {
      return item.label === 'Navigate';
    });
    expect(go?.submenu).toStrictEqual([
      { id: 'a', label: 'a' },
      { type: 'separator' },
      { id: 'b', label: 'b' },
      {
        label: 'More',
        submenu: [{ id: 'c', label: 'c' }, { type: 'separator' }, { id: 'd', label: 'd' }],
      },
    ]);
  });
});

describe('contextMenuTemplateFrom', () => {
  test('lists a kind’s commands by menu, keys shown but not registered', ({ expect }) => {
    const items = contextMenuTemplateFrom(commandCatalog, 'line', 'mac');
    expect(items.find((item) => item.id === 'add-to-chat')).toStrictEqual({
      id: 'add-to-chat',
      label: 'Add to Chat',
      accelerator: 'Cmd+>',
      registerAccelerator: false,
    });
  });

  test('lays out a note’s menu by hand, with Label and Status submenus', ({ expect }) => {
    const items = contextMenuTemplateFrom(commandCatalog, 'note', 'mac');
    const shapeOf = (item: MenuTemplateItem): unknown => {
      if (item.submenu !== undefined) {
        return { [item.label ?? '']: item.submenu.map((entry) => shapeOf(entry)) };
      }
      return item.label ?? item.type;
    };
    expect(items.map((item) => shapeOf(item))).toStrictEqual([
      'Show in Diff',
      'Open in Editor',
      'separator',
      'Edit…',
      {
        Label: [
          'Issue',
          'Suggestion',
          'Question',
          'Nitpick',
          'Thought',
          'Smell',
          'Praise',
          'Note',
          'Todo',
          'Chore',
          'separator',
          'Blocking',
        ],
      },
      'separator',
      { Status: ['Open', 'separator', 'Addressed', 'Withdrawn'] },
      'separator',
      'Move Up',
      'Move Down',
      'separator',
      'Add to Chat',
      'separator',
      'Delete',
    ]);
    const label = items.find((item) => item.label === 'Label')?.submenu ?? [];
    expect(label.find((item) => item.id === 'dock-blocking')).toStrictEqual({
      id: 'dock-blocking',
      label: 'Blocking',
      type: 'checkbox',
    });
    expect(items.find((item) => item.id === 'dock-move-up')).toStrictEqual({
      id: 'dock-move-up',
      label: 'Move Up',
    });
  });

  test('lays out every command that lists a laid-out kind, and only those', ({ expect }) => {
    const idsOf = (sections: ContextMenuLayout | ContextSubmenu['sections']): string[] => {
      return sections.flat().flatMap((entry) => {
        if ('submenu' in entry) {
          return idsOf(entry.sections);
        }
        return entry.id;
      });
    };
    for (const [kind, layout] of Object.entries(contextMenuLayouts)) {
      const listed = commandCatalog
        .filter((command) => {
          return (command.context as readonly string[] | undefined)?.includes(kind) === true;
        })
        .map((command) => command.id);
      expect(idsOf(layout).toSorted(byName)).toStrictEqual(listed.toSorted(byName));
    }
  });

  test('offers the editing roles in a text field', ({ expect }) => {
    expect(
      contextMenuTemplateFrom(commandCatalog, 'text', 'linux').map((item) => {
        return item.role ?? item.type;
      }),
    ).toStrictEqual(['undo', 'redo', 'separator', 'cut', 'copy', 'paste', 'selectAll']);
  });

  test('opens a file a chat answer names in a sheet, or copies its path', ({ expect }) => {
    expect(
      contextMenuTemplateFrom(commandCatalog, 'reference', 'mac').map((item) => {
        return item.id ?? item.type;
      }),
    ).toStrictEqual(['open-in-sheet', 'separator', 'copy-path']);
  });

  test('puts commands without a menu item last', ({ expect }) => {
    const catalog: CatalogCommand[] = [
      {
        id: 'unplaced',
        title: 'Unplaced',
        context: ['line'],
        windows: ['main'],
        handler: 'window',
      },
      {
        id: 'placed',
        title: 'Placed',
        menu: { menu: 'review', group: 0 },
        context: ['line'],
        windows: ['main'],
        handler: 'window',
      },
    ];
    expect(contextMenuTemplateFrom(catalog, 'line', 'linux')).toStrictEqual([
      { id: 'placed', label: 'Placed' },
      { type: 'separator' },
      { id: 'unplaced', label: 'Unplaced' },
    ]);
  });
});

function topLabels(platform: KeyPlatform): (string | undefined)[] {
  return menuTemplateFrom({ catalog: commandCatalog, platform }).map((item) => {
    return item.label ?? item.role;
  });
}

function catalogKeys(platform: KeyPlatform): string[] {
  return commandCatalog.flatMap((command) => {
    return acceleratorsFor(command, platform).map((key) => normalized(key));
  });
}

/** Super chords, workspace switching, IBus and the menus' own Alt access keys. */
function isLinuxReserved(key: string): boolean {
  return (
    /\b(?:Super|Meta)\b/u.test(key) ||
    /^Alt\+Ctrl\+(?:Up|Down|Left|Right)$/u.test(key) ||
    ['Ctrl+.', 'Ctrl+;', 'Ctrl+Shift+U', 'Alt+F4', 'Alt+Tab', 'Ctrl+Alt+T']
      .map((reserved) => normalized(reserved))
      .includes(key) ||
    /^Alt\+[CEFGHRVW]$/u.test(key)
  );
}

/** A Linux label without its access key. */
function plain(label: string | undefined): string | undefined {
  return label?.replace('&', '');
}

function flatten(items: readonly MenuTemplateItem[]): MenuTemplateItem[] {
  return items.flatMap((item) => {
    return [item, ...flatten(item.submenu ?? [])];
  });
}

/** Modifiers in a fixed order, `Cmd`/`Ctrl` and the rest as written, so equal chords compare equal. */
function normalized(accelerator: string): string {
  const parts = accelerator.split(/\+(?!$)/u);
  const key = parts.at(-1) ?? '';
  const order = ['Alt', 'Ctrl', 'Shift', 'Cmd'];
  const modifiers = parts
    .slice(0, -1)
    .toSorted((left, right) => order.indexOf(left) - order.indexOf(right));
  return [...modifiers, key].join('+');
}

function isChord(accelerator: string): boolean {
  return /(?:^|\+)(?:Alt|Ctrl|Cmd)\+/u.test(accelerator) || /(?:^|\+)F\d+$/u.test(accelerator);
}

function command(id: string, menu: CatalogCommand['menu']): CatalogCommand {
  return {
    id,
    title: id,
    ...(menu !== undefined && { menu }),
    windows: ['main'],
    handler: 'window',
  };
}

function byName(left: string, right: string): number {
  return left.localeCompare(right);
}
