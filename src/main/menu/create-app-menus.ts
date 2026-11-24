import { BrowserWindow, Menu, nativeTheme, webContents } from 'electron';
import type { MenuItem, MenuItemConstructorOptions, NativeImage } from 'electron';

import type { Logger } from '#x/log/create-logger.ts';

import { commandCatalog } from '#contract/command-catalog.ts';
import type {
  CatalogCommand,
  CommandId,
  KeyPlatform,
  MenuIcon,
  WindowKind,
} from '#contract/command-catalog.ts';
import type { MenuContextRequest, MenuStateRequest } from '#contract/ipc-contract.ts';

import { sendEvent } from '../ipc/send-event.ts';
import { contextMenuTemplateFrom } from './context-menu-template-from.ts';
import { menuIconImage } from './menu-icon-image.ts';
import { menuItemStatesFrom } from './menu-item-states-from.ts';
import type { MenuItemState } from './menu-item-states-from.ts';
import { menuTemplateFrom } from './menu-template-from.ts';
import type { MenuTemplateItem } from './menu-template-item.ts';
import { yieldToTerminal } from './yield-to-terminal.ts';

export interface AppMenusOptions {
  readonly platform: KeyPlatform;
  /** Runs a command whose catalog `handler` is `main` (Settings, About, …). */
  readonly runMain: (id: CommandId, window: BrowserWindow | undefined) => void;
  /** Opens and tracks a new main window, for commands that `opensMainWindow`. */
  readonly openMainWindow: () => BrowserWindow;
  readonly logger: Logger;
}

/** The menu bar, context menus and shortcut dispatch of every window (ADR 0068). */
export interface AppMenus {
  /** Gives a new window its menu (Linux; macOS shares the app menu) and its kind's state. */
  readonly track: (window: BrowserWindow, kind: WindowKind) => void;
  /** `menu:set-state` from a window's page, already validated. */
  readonly setState: (webContentsId: number, state: MenuStateRequest) => void;
  /** `menu:context`: pops up the context menu of `kind` in the sender's window. */
  readonly popup: (webContentsId: number, request: MenuContextRequest) => boolean;
  /** `menu:run-main` from the palette: true when `id` is a main command and ran. */
  readonly runMainCommand: (webContentsId: number, id: string) => boolean;
}

const emptyState: MenuStateRequest = { conditions: [], checked: [] };
const byId: ReadonlyMap<string, CatalogCommand> = new Map(
  commandCatalog.map((command) => {
    return [command.id, command];
  }),
);

/**
 * Builds the menus from the command catalog and makes the menu the single dispatcher of chorded
 * keys: a click or accelerator sends `menu:run { id }` to the window it came from, and only for a
 * command that window's kind runs and its last reported state enables. On macOS one app menu is
 * shared and takes the focused window's state when focus moves; on Linux every window has its own
 * menu (sheets and Settings hide it until Alt). Enabled and checked are changed in place, which
 * Electron documents as dynamic, so the menu is built once per window.
 */
export function createAppMenus(options: AppMenusOptions): AppMenus {
  const { platform, logger } = options;
  const kinds = new Map<number, WindowKind>();
  const states = new Map<number, MenuStateRequest>();
  const menus = new Map<number, Menu>();
  const template = menuTemplateFrom({ catalog: commandCatalog, platform });

  const dispatch = (itemId: string, window: BrowserWindow | undefined): void => {
    const id = commandIdOfItem(itemId);
    const command = byId.get(id);
    if (command === undefined) {
      return;
    }
    if (command.handler === 'main') {
      options.runMain(command.id as CommandId, window);
      return;
    }
    if (command.opensMainWindow === true && !hasMainWindow()) {
      const opened = options.openMainWindow();
      opened.webContents.once('did-finish-load', () => {
        sendEvent(opened.webContents, 'menu:run', { id: command.id as CommandId });
      });
      return;
    }
    const contents = window?.webContents;
    if (contents === undefined || !isEnabled(contents.id, command.id)) {
      logger.debug('menu command not sent', { id });
      return;
    }
    sendEvent(contents, 'menu:run', { id: command.id as CommandId });
  };

  const isEnabled = (contentsId: number, id: string): boolean => {
    const kind = kinds.get(contentsId);
    return kind !== undefined && statesOf(contentsId, kind).get(id)?.enabled === true;
  };

  const hasMainWindow = (): boolean => {
    return kinds.values().toArray().includes('main');
  };

  const statesOf = (contentsId: number, kind: WindowKind): ReadonlyMap<string, MenuItemState> => {
    const state = states.get(contentsId) ?? emptyState;
    return withWindowOpeners(
      yieldToTerminal(menuItemStatesFrom(commandCatalog, kind, state), {
        catalog: commandCatalog,
        conditions: state.conditions,
        platform,
      }),
    );
  };

  /** Commands that open a main window are enabled while none is open. */
  const withWindowOpeners = (
    base: ReadonlyMap<string, MenuItemState>,
  ): ReadonlyMap<string, MenuItemState> => {
    if (hasMainWindow()) {
      return base;
    }
    const opened = new Map(base);
    for (const command of commandCatalog) {
      if (command.opensMainWindow === true) {
        opened.set(command.id, { enabled: true, checked: false });
      }
    }
    return opened;
  };

  /** The images of the catalog's icons, drawn once per theme (ADR 0144). */
  let icons = new Map<MenuIcon, NativeImage>();
  const iconOf = (icon: MenuIcon): NativeImage => {
    return icons.getOrInsertComputed(icon, () => menuIconImage(icon, platform));
  };

  const build = (): Menu => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-class-instance-assignment -- Electron's typings declare the exported class as a subclass of Electron.X, so the base class its own APIs return is not an instance of it nominally.
    return Menu.buildFromTemplate(withClicks(template, { dispatch, iconOf }));
  };

  let appMenu: Menu | undefined;
  if (platform === 'mac') {
    appMenu = build();
  }
  // eslint-disable-next-line unicorn/no-null -- Electron removes the default menu with null.
  Menu.setApplicationMenu(appMenu ?? null);

  /** Applies `states` and the names that follow them to `menu`. */
  const apply = (menu: Menu, states: ReadonlyMap<string, MenuItemState>): void => {
    applyStates(menu, states);
    applyCheckedLabels(menu, { items: template, states });
  };

  const refresh = (contentsId: number): void => {
    const kind = kinds.get(contentsId);
    const menu = appMenu ?? menus.get(contentsId);
    if (kind === undefined || menu === undefined) {
      return;
    }
    if (appMenu !== undefined && BrowserWindow.getFocusedWindow()?.webContents.id !== contentsId) {
      return;
    }
    apply(menu, statesOf(contentsId, kind));
  };

  /** Builds every window's menu again (Linux), with icons drawn for the current theme. */
  const rebuild = (): void => {
    for (const contentsId of menus.keys()) {
      const window = windowOfContents(contentsId);
      if (window === undefined) {
        continue;
      }
      const menu = build();
      menus.set(contentsId, menu);
      window.setMenu(menu);
      refresh(contentsId);
    }
  };

  if (appMenu === undefined) {
    // Linux icons are inked for the theme, so a theme change draws them again.
    nativeTheme.on('updated', () => {
      icons = new Map();
      rebuild();
    });
  }

  return {
    track: (window, kind): void => {
      const contentsId = window.webContents.id;
      kinds.set(contentsId, kind);
      if (appMenu === undefined) {
        const menu = build();
        menus.set(contentsId, menu);
        window.setMenu(menu);
        if (kind !== 'main') {
          window.setAutoHideMenuBar(true);
          window.setMenuBarVisibility(false);
        }
      }
      window.on('focus', () => {
        refresh(contentsId);
      });
      window.on('closed', () => {
        kinds.delete(contentsId);
        states.delete(contentsId);
        menus.delete(contentsId);
        if (appMenu !== undefined && BrowserWindow.getFocusedWindow() === null) {
          apply(
            appMenu,
            withWindowOpeners(menuItemStatesFrom(commandCatalog, 'settings', emptyState)),
          );
        }
      });
      refresh(contentsId);
    },
    setState: (contentsId, state): void => {
      if (!kinds.has(contentsId)) {
        return;
      }
      states.set(contentsId, state);
      refresh(contentsId);
    },
    popup: (contentsId, request): boolean => {
      const kind = kinds.get(contentsId);
      const window = windowOfContents(contentsId);
      if (kind === undefined || window === undefined) {
        return false;
      }
      const items = contextMenuTemplateFrom(commandCatalog, request.kind, platform);
      if (items.length === 0) {
        return false;
      }
      const menu = Menu.buildFromTemplate(
        withClicks(items, {
          dispatch: (id): void => {
            dispatch(id, window);
          },
          iconOf,
        }),
      );
      const states = statesOf(contentsId, kind);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-class-instance-assignment -- Electron's typings declare the exported class as a subclass of Electron.X, so the base class its own APIs return is not an instance of it nominally.
      applyStates(menu, states);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-class-instance-assignment -- Electron's typings declare the exported class as a subclass of Electron.X, so the base class its own APIs return is not an instance of it nominally.
      applyCheckedLabels(menu, { items, states });
      menu.popup({
        window,
        ...(request.x !== undefined && { x: Math.round(request.x) }),
        ...(request.y !== undefined && { y: Math.round(request.y) }),
      });
      return true;
    },
    runMainCommand: (contentsId, id): boolean => {
      const command = byId.get(id);
      const contents = webContents.fromId(contentsId);
      if (contents === undefined || command?.handler !== 'main') {
        return false;
      }
      options.runMain(
        command.id as CommandId,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-class-instance-assignment -- Electron's typings declare the exported class as a subclass of Electron.X, so the base class its own APIs return is not an instance of it nominally.
        BrowserWindow.fromWebContents(contents) ?? undefined,
      );
      return true;
    },
  };
}

/** The command of a menu item id: `<id>`, or `<id>~<n>` for an alternate key. */
function commandIdOfItem(itemId: string): string {
  const [id = itemId] = itemId.split('~', 1);
  return id;
}

/** The menu item id of a command's `index`th accelerator: `<id>`, then `<id>~1`, `<id>~2`, … */
function itemIdAt(id: string, index: number): string {
  if (index === 0) {
    return id;
  }
  return `${id}~${String(index)}`;
}

/** What turns template items into Electron's: the click's dispatch and the icons' images. */
interface ItemWiring {
  readonly dispatch: (id: string, window: BrowserWindow | undefined) => void;
  readonly iconOf: (icon: MenuIcon) => NativeImage;
}

/**
 * Electron's options with a click on every item that names a command (`<id>~n` runs `<id>`) and
 * the image of its icon; the checked label stays behind for {@link applyCheckedLabels}.
 */
function withClicks(
  items: readonly MenuTemplateItem[],
  wiring: ItemWiring,
): MenuItemConstructorOptions[] {
  return items.map((item): MenuItemConstructorOptions => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Electron has no checked label; applyCheckedLabels reads it from the template.
    const { submenu, id, icon, checkedLabel, ...rest } = item;
    return {
      ...rest,
      ...(icon !== undefined && { icon: wiring.iconOf(icon) }),
      ...(id !== undefined && {
        id,
        click: (_menuItem, window): void => {
          wiring.dispatch(id, browserWindowOf(window));
        },
      }),
      ...(submenu !== undefined && { submenu: withClicks(submenu, wiring) }),
    };
  });
}

function windowOfContents(contentsId: number): BrowserWindow | undefined {
  const contents = webContents.fromId(contentsId);
  if (contents === undefined) {
    return undefined;
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-class-instance-assignment -- Electron's typings declare the exported class as a subclass of Electron.X, so the base class its own APIs return is not an instance of it nominally.
  return BrowserWindow.fromWebContents(contents) ?? undefined;
}

function browserWindowOf(window: unknown): BrowserWindow | undefined {
  if (window instanceof BrowserWindow) {
    return window;
  }
  return undefined;
}

function applyStates(menu: Menu, states: ReadonlyMap<string, MenuItemState>): void {
  for (const [id, state] of states) {
    const command = byId.get(id);
    let lastAlias = 0;
    if (command?.keys !== undefined) {
      lastAlias = 3;
    }
    for (let index = 0; index <= lastAlias; index += 1) {
      const item = menu.getMenuItemById(itemIdAt(id, index));
      if (item === null) {
        continue;
      }
      item.enabled = state.enabled;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-class-instance-assignment -- Electron's typings declare the exported class as a subclass of Electron.X, so the base class its own APIs return is not an instance of it nominally.
      if (index === 0 && (command?.toggle !== undefined || isToggleItem(item))) {
        item.checked = state.checked;
      }
    }
  }
}

/** A context menu may show a command as a checkbox the catalog does not (ADR 0150). */
function isToggleItem(item: MenuItem): boolean {
  return item.type === 'checkbox' || item.type === 'radio';
}

/** A menu's template items, and the states whose checks pick their labels. */
interface CheckedLabelStates {
  readonly items: readonly MenuTemplateItem[];
  readonly states: ReadonlyMap<string, MenuItemState>;
}

/**
 * Shows the checked label of every item that has one while its command is checked, and its own
 * label otherwise (ADR 0144): Withdraw becomes Restore. Electron documents `label` as dynamic.
 */
function applyCheckedLabels(menu: Menu, { items, states }: CheckedLabelStates): void {
  for (const item of items) {
    if (item.submenu !== undefined) {
      applyCheckedLabels(menu, { items: item.submenu, states });
    }
    if (item.id === undefined || item.checkedLabel === undefined || item.label === undefined) {
      continue;
    }
    const menuItem = menu.getMenuItemById(item.id);
    if (menuItem === null) {
      continue;
    }
    if (states.get(item.id)?.checked === true) {
      menuItem.label = item.checkedLabel;
    } else {
      menuItem.label = item.label;
    }
  }
}
