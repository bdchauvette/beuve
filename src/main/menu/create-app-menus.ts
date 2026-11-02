import { BrowserWindow, Menu, webContents } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';

import type { Logger } from '#x/log/create-logger.ts';

import { commandCatalog } from '#contract/command-catalog.ts';
import type {
  CatalogCommand,
  CommandId,
  KeyPlatform,
  WindowKind,
} from '#contract/command-catalog.ts';
import type { MenuContextRequest, MenuStateRequest } from '#contract/ipc-contract.ts';

import { sendEvent } from '../ipc/send-event.ts';
import { contextMenuTemplateFrom } from './context-menu-template-from.ts';
import { menuItemStatesFrom } from './menu-item-states-from.ts';
import type { MenuItemState } from './menu-item-states-from.ts';
import { menuTemplateFrom } from './menu-template-from.ts';
import type { MenuTemplateItem } from './menu-template-item.ts';
import { yieldToTerminal } from './yield-to-terminal.ts';

export interface AppMenusOptions {
  readonly platform: KeyPlatform;
  readonly isPackaged: boolean;
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
  const template = menuTemplateFrom({
    catalog: commandCatalog,
    platform,
    isPackaged: options.isPackaged,
  });

  const dispatch = (id: string, window: BrowserWindow | undefined): void => {
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

  const build = (): Menu => Menu.buildFromTemplate(withClicks(template, dispatch));

  let appMenu: Menu | undefined;
  if (platform === 'mac') {
    appMenu = build();
  }
  // eslint-disable-next-line unicorn/no-null -- Electron removes the default menu with null.
  Menu.setApplicationMenu(appMenu ?? null);

  const refresh = (contentsId: number): void => {
    const kind = kinds.get(contentsId);
    const menu = appMenu ?? menus.get(contentsId);
    if (kind === undefined || menu === undefined) {
      return;
    }
    if (appMenu !== undefined && BrowserWindow.getFocusedWindow()?.webContents.id !== contentsId) {
      return;
    }
    applyStates(menu, statesOf(contentsId, kind));
  };

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
          applyStates(
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
        withClicks(items, (id) => {
          dispatch(id, window);
        }),
      );
      applyStates(menu, statesOf(contentsId, kind));
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
        BrowserWindow.fromWebContents(contents) ?? undefined,
      );
      return true;
    },
  };
}

/** The menu item id of a command's `index`th accelerator: `<id>`, then `<id>~1`, `<id>~2`, … */
function itemIdAt(id: string, index: number): string {
  if (index === 0) {
    return id;
  }
  return `${id}~${String(index)}`;
}

/** Electron's options with a click on every item that names a command (`<id>~n` runs `<id>`). */
function withClicks(
  items: readonly MenuTemplateItem[],
  dispatch: (id: string, window: BrowserWindow | undefined) => void,
): MenuItemConstructorOptions[] {
  return items.map((item): MenuItemConstructorOptions => {
    const { submenu, id, ...rest } = item;
    return {
      ...rest,
      ...(id !== undefined && {
        id,
        click: (_menuItem, window): void => {
          dispatch(id.split('~', 1)[0] ?? id, browserWindowOf(window));
        },
      }),
      ...(submenu !== undefined && { submenu: withClicks(submenu, dispatch) }),
    };
  });
}

function windowOfContents(contentsId: number): BrowserWindow | undefined {
  const contents = webContents.fromId(contentsId);
  if (contents === undefined) {
    return undefined;
  }
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
      if (index === 0 && command?.toggle !== undefined) {
        item.checked = state.checked;
      }
    }
  }
}
