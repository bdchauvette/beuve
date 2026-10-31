import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { BrowserWindow, clipboard, dialog, ipcMain, session, shell } from 'electron';
import type { App } from 'electron';

import type { Logger } from '#x/log/create-logger.ts';

import type { CommandId } from '#contract/command-catalog.ts';
import type { AppInfo, McpStatus } from '#contract/ipc-contract.ts';
import { mainWindowInvokeChannels } from '#contract/main-window-invoke-channels.ts';
import { settingsInvokeChannels } from '#contract/settings-invoke-channels.ts';
import { sheetInvokeChannels } from '#contract/sheet-invoke-channels.ts';

import { createIpcHandlers } from './ipc/create-ipc-handlers.ts';
import { registerIpcHandlers } from './ipc/register-ipc-handlers.ts';
import { RequestScopes } from './ipc/request-scopes.ts';
import { sendEvent } from './ipc/send-event.ts';
import { withSettingsBroadcast } from './ipc/with-settings-broadcast.ts';
import type { MainServices } from './main-services.ts';
import { launchMcpServer } from './mcp/launch-mcp-server.ts';
import { createAppMenus } from './menu/create-app-menus.ts';
import { createMainWindow } from './window/create-main-window.ts';
import { createSettingsWindow } from './window/create-settings-window.ts';
import { createSheetWindows } from './window/create-sheet-windows.ts';
import { hardenSession } from './window/harden-session.ts';
import { hardenWebContents } from './window/harden-web-contents.ts';

const projectUrl = 'https://github.com/bdchauvette/beuve';

export interface StartAppOptions {
  readonly services: MainServices;
  readonly preloadPath: string;
  readonly indexHtmlPath: string;
  /** The sheet page and its preload (ADR 0067). */
  readonly sheetPreloadPath: string;
  readonly sheetHtmlPath: string;
  /** The Settings window's page and preload (ADR 0068). */
  readonly settingsPreloadPath: string;
  readonly settingsHtmlPath: string;
  readonly mcpPort: number;
  readonly logger: Logger;
}

/**
 * Composes the running app once Electron is ready: worktree cleanup, security policy, IPC,
 * review progress, chat, URA and GitHub events, the clipboard, the menus (ADR 0068), the main
 * window (whose focus sets the GitHub polling pace), sheets, Settings and the MCP server; preliminary reviews are aborted and language
 * servers disposed before quitting. Call from `app.once('ready')`; never awaited at top
 * level (see CLAUDE.md).
 */
export async function startApp(app: App, options: StartAppOptions): Promise<void> {
  const { logger, services } = options;
  let mcpStatus: McpStatus = { state: 'starting' };
  const publishMcpStatus = (status: McpStatus): void => {
    mcpStatus = status;
    for (const window of BrowserWindow.getAllWindows()) {
      sendEvent(window.webContents, 'mcp:status', status);
    }
  };
  const handleMainCommand = (id: CommandId): void => {
    switch (id) {
      case 'settings': {
        settingsWindow.open();
        return;
      }
      case 'about': {
        app.showAboutPanel();
        return;
      }
      case 'close-all-sheets': {
        sheets.closeAll();
        return;
      }
      case 'github-home': {
        void shell.openExternal(projectUrl);
        return;
      }
      default: {
        logger.warn('not a main-process command', { id });
      }
    }
  };
  const menus = createAppMenus({
    platform: process.platform === 'darwin' ? 'mac' : 'linux',
    isPackaged: app.isPackaged,
    runMain: handleMainCommand,
    logger,
  });
  const sheets = createSheetWindows({
    preloadPath: options.sheetPreloadPath,
    sheetHtmlPath: options.sheetHtmlPath,
    onCreated: (window) => {
      menus.track(window, 'sheet');
    },
  });
  const settingsWindow = createSettingsWindow({
    preloadPath: options.settingsPreloadPath,
    settingsHtmlPath: options.settingsHtmlPath,
    onCreated: (window) => {
      menus.track(window, 'settings');
    },
  });
  const openWindow = (): void => {
    const window = createMainWindow(options);
    menus.track(window, 'main');
    window.webContents.on('did-finish-load', () => {
      sendEvent(window.webContents, 'mcp:status', mcpStatus);
    });
    // Poll GitHub on the interval while beuve has focus, less often otherwise (ADR 0038).
    window.on('focus', () => {
      services.github.setForeground(true);
    });
    window.on('blur', () => {
      services.github.setForeground(false);
    });
  };

  services.chat.onStream((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      sendEvent(window.webContents, 'chat:stream', event);
    }
  });
  services.trace.onStatus((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      sendEvent(window.webContents, 'trace:status', event);
    }
  });
  services.ura.onChanged((sessionId) => {
    for (const window of BrowserWindow.getAllWindows()) {
      sendEvent(window.webContents, 'ura:changed', { sessionId });
    }
  });
  services.github.onPullRequestUpdated((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      sendEvent(window.webContents, 'github:pr-updated', event);
    }
  });
  services.github.onCiStatus((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      sendEvent(window.webContents, 'github:ci-status', event);
    }
  });
  void services.pruneWorktrees();
  hardenSession(session.defaultSession);
  const scopes = new RequestScopes();
  app.on('web-contents-created', (_event, contents) => {
    hardenWebContents(contents, logger);
    // A closed or reloaded window's loads would answer nobody: stop them, git included (ADR 0079).
    const { id } = contents;
    contents.once('destroyed', () => {
      scopes.closeWindow(id);
    });
    contents.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) {
        scopes.closeWindow(id);
      }
    });
  });
  // The renderer's own clipboard needs a permission the hardened session denies (ADR 0027).
  const platform = {
    writeClipboard: async (text: string): Promise<void> => {
      return clipboard.writeText(text);
    },
    chooseFolder: async (picker: {
      readonly title?: string;
      readonly defaultPath?: string;
    }): Promise<string | undefined> => {
      const options: Electron.OpenDialogOptions = {
        properties: ['openDirectory', 'createDirectory'],
        ...(picker.title !== undefined && { title: picker.title }),
        ...(picker.defaultPath !== undefined && { defaultPath: picker.defaultPath }),
      };
      const owner = BrowserWindow.getFocusedWindow();
      const chosen =
        owner === null
          ? await dialog.showOpenDialog(options)
          : await dialog.showOpenDialog(owner, options);
      return chosen.canceled ? undefined : chosen.filePaths[0];
    },
  };
  const handlers = createIpcHandlers(
    services,
    readAppInfo(app),
    { ...platform, openSheet: sheets.open, menus },
    scopes,
  );

  registerIpcHandlers(ipcMain, withSettingsBroadcast(handlers, announceSettingsChanged), {
    pages: [
      // Everything but the model registry, which only the Settings window may touch (ADR 0070).
      { url: pathToFileURL(options.indexHtmlPath).href, channels: mainWindowInvokeChannels },
      { url: pathToFileURL(options.sheetHtmlPath).href, channels: sheetInvokeChannels },
      { url: pathToFileURL(options.settingsHtmlPath).href, channels: settingsInvokeChannels },
    ],
    logger,
  });

  openWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().every((window) => !isMainWindow(window, options))) {
      openWindow();
    }
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  const stopMcp = await launchMcpServer({
    directory: app.getPath('userData'),
    services: services.mcpTools,
    logger,
    version: app.getVersion(),
    port: options.mcpPort,
    onStatus: publishMcpStatus,
  });
  stopBeforeQuit(app, async (): Promise<void> => {
    await stopMcp();
    await services.dispose();
  });
}

/** Sheets and Settings alone don't count as the app being open: the dock icon brings the main window back. */
function isMainWindow(window: BrowserWindow, options: StartAppOptions): boolean {
  const url = window.webContents.getURL();
  return url === '' || url.startsWith(pathToFileURL(options.indexHtmlPath).href);
}

/** `settings:changed` to every window but the one that made the change. */
function announceSettingsChanged(sender: { readonly webContentsId: number } | undefined): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.webContents.id !== sender?.webContentsId) {
      sendEvent(window.webContents, 'settings:changed', {});
    }
  }
}

function readAppInfo(app: App): AppInfo {
  return {
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
  };
}

function stopBeforeQuit(app: App, stop: () => Promise<void>): void {
  let isStopping = false;
  app.on('will-quit', (event) => {
    if (isStopping) {
      return;
    }
    event.preventDefault();
    isStopping = true;
    void (async (): Promise<void> => {
      await stop();
      app.quit();
    })();
  });
}
