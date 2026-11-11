import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { BrowserWindow, clipboard, dialog, ipcMain, session, shell } from 'electron';
import type { App, WebContents } from 'electron';

import type { Logger } from '#x/log/create-logger.ts';

import type { CommandId, KeyPlatform } from '#contract/command-catalog.ts';
import type { AppInfo, ChooseFolderRequest } from '#contract/ipc-contract.ts';
import { mainWindowInvokeChannels } from '#contract/main-window-invoke-channels.ts';
import { settingsInvokeChannels } from '#contract/settings-invoke-channels.ts';
import { sheetInvokeChannels } from '#contract/sheet-invoke-channels.ts';

import { createIpcHandlers } from './ipc/create-ipc-handlers.ts';
import type { IpcSender } from './ipc/create-ipc-handlers.ts';
import { registerIpcHandlers } from './ipc/register-ipc-handlers.ts';
import { RequestScopes } from './ipc/request-scopes.ts';
import { sendEvent } from './ipc/send-event.ts';
import { withSettingsBroadcast } from './ipc/with-settings-broadcast.ts';
import type { MainServices } from './main-services.ts';
import { handleGithubLink } from './links/handle-github-link.ts';
import type { GithubLinkTarget } from './links/handle-github-link.ts';
import type { LinkInbox } from './links/link-inbox.ts';
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
  /** `beuve://` links to open pull requests with (ADR 0098). */
  readonly links: LinkInbox;
  /** This run's log file, which Help › Show Log File reveals. */
  readonly logPath: string;
  readonly logger: Logger;
}

/**
 * Composes the running app once Electron is ready: worktree cleanup, security policy, IPC,
 * review progress, chat, URA and GitHub events, the clipboard, the menus (ADR 0068), the main
 * window (whose focus sets the GitHub polling pace), sheets and Settings; language servers are
 * disposed before quitting. Call from `app.once('ready')`, never at the top level of the entry
 * (see CLAUDE.md).
 */
export function startApp(app: App, options: StartAppOptions): void {
  const { logger, services } = options;
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
      case 'show-log': {
        shell.showItemInFolder(options.logPath);
        return;
      }
      default: {
        logger.warn('not a main-process command', { id });
      }
    }
  };
  const menus = createAppMenus({
    platform: keyPlatform(),
    isPackaged: app.isPackaged,
    runMain: handleMainCommand,
    openMainWindow: (): BrowserWindow => {
      return openWindow();
    },
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
  /** Terminal output goes to main windows only, never to sheets or Settings (ADR 0095). */
  const mainWindowContents = new Set<WebContents>();
  const openWindow = (): BrowserWindow => {
    const window = createMainWindow(options);
    menus.track(window, 'main');
    const { webContents } = window;
    mainWindowContents.add(webContents);
    window.once('closed', () => {
      // `window.webContents` throws once the window is destroyed.
      mainWindowContents.delete(webContents);
    });
    // Poll GitHub on the interval while beuve has focus, less often otherwise (ADR 0038).
    window.on('focus', () => {
      services.github.setForeground(true);
      services.queue.setForeground(true);
    });
    window.on('blur', () => {
      services.github.setForeground(false);
      services.queue.setForeground(false);
    });
    return window;
  };

  services.chat.onStream((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      sendEvent(window.webContents, 'chat:stream', event);
    }
  });
  services.terminal.onData((event) => {
    for (const contents of mainWindowContents) {
      sendEvent(contents, 'terminal:data', event);
    }
  });
  services.terminal.onExit((event) => {
    for (const contents of mainWindowContents) {
      sendEvent(contents, 'terminal:exit', event);
    }
  });
  services.setup.onFinished((event) => {
    for (const contents of mainWindowContents) {
      sendEvent(contents, 'setup:finished', event);
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
  services.github.onBranchUpdated((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      sendEvent(window.webContents, 'github:branch-updated', event);
    }
  });
  services.queue.onUpdated((event) => {
    for (const contents of mainWindowContents) {
      sendEvent(contents, 'queue:updated', event);
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
    chooseFolder: async (picker: ChooseFolderRequest): Promise<string | undefined> => {
      const options: Electron.OpenDialogOptions = {
        properties: ['openDirectory', 'createDirectory'],
        ...(picker.title !== undefined && { title: picker.title }),
        ...(picker.defaultPath !== undefined && { defaultPath: picker.defaultPath }),
      };
      const chosen = await showOpenDialog(options);
      if (chosen.canceled) {
        return undefined;
      }
      return chosen.filePaths[0];
    },
  };
  const handlers = createIpcHandlers(services, readAppInfo(app), {
    ...platform,
    openSheet: sheets.open,
    menus,
    scopes,
  });

  registerIpcHandlers(ipcMain, withSettingsBroadcast(handlers, announceSettingsChanged), {
    pages: [
      // Everything but the model registry, which only the Settings window may touch (ADR 0070).
      { url: pathToFileURL(options.indexHtmlPath).href, channels: mainWindowInvokeChannels },
      { url: pathToFileURL(options.sheetHtmlPath).href, channels: sheetInvokeChannels },
      { url: pathToFileURL(options.settingsHtmlPath).href, channels: settingsInvokeChannels },
    ],
    logger,
  });

  const showInMainWindow = (target: GithubLinkTarget): void => {
    const window =
      BrowserWindow.getAllWindows().find((candidate) => isMainWindow(candidate, options)) ??
      openWindow();
    if (window.isMinimized()) {
      window.restore();
    }
    window.show();
    window.focus();
    const { webContents } = window;
    const send = (): void => {
      if (target.kind === 'branch') {
        sendEvent(webContents, 'link:open-branch', { ref: target.text });
      } else {
        sendEvent(webContents, 'link:open-pr', { ref: target.text });
      }
    };
    if (webContents.isLoading()) {
      webContents.once('did-finish-load', send);
      return;
    }
    send();
  };

  openWindow();
  options.links.attach((link) => {
    void handleGithubLink(link, {
      confirm: isOpenConfirmed,
      reportInvalid: (reason) => {
        logger.warn('refused a beuve:// link', { reason });
        dialog.showErrorBox('beuve can’t open that link', reason);
      },
      open: showInMainWindow,
    });
  });
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

  stopBeforeQuit(app, async (): Promise<void> => {
    await services.dispose();
  });
}

/** Sheets and Settings alone don't count as the app being open: the dock icon brings the main window back. */
function isMainWindow(window: BrowserWindow, options: StartAppOptions): boolean {
  const url = window.webContents.getURL();
  return url === '' || url.startsWith(pathToFileURL(options.indexHtmlPath).href);
}

/** `settings:changed` to every window but the one that made the change. */
function announceSettingsChanged(sender: IpcSender | undefined): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.webContents.id !== sender?.webContentsId) {
      sendEvent(window.webContents, 'settings:changed', {});
    }
  }
}

function keyPlatform(): KeyPlatform {
  if (process.platform === 'darwin') {
    return 'mac';
  }
  return 'linux';
}

/** The open dialog, as a sheet of the focused window when there is one. */
async function showOpenDialog(
  options: Electron.OpenDialogOptions,
): Promise<Electron.OpenDialogReturnValue> {
  const owner = BrowserWindow.getFocusedWindow();
  if (owner === null) {
    return dialog.showOpenDialog(options);
  }
  return dialog.showOpenDialog(owner, options);
}

/**
 * Asks, as a sheet of the focused window when there is one, before a link opens a pull request or
 * follows a branch.
 */
async function isOpenConfirmed({ kind, text }: GithubLinkTarget): Promise<boolean> {
  let message = `Open pull request ${text}?`;
  if (kind === 'branch') {
    message = `Follow branch ${text}?`;
  }
  const options: Electron.MessageBoxOptions = {
    type: 'question',
    message,
    detail:
      'A link asked beuve to open it. beuve will fetch its head into a local review checkout; it never pushes.',
    buttons: ['Open', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
  };
  const owner = BrowserWindow.getFocusedWindow();
  if (owner === null) {
    const answer = await dialog.showMessageBox(options);
    return answer.response === 0;
  }
  const answer = await dialog.showMessageBox(owner, options);
  return answer.response === 0;
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
