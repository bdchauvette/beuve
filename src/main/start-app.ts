import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { BrowserWindow, clipboard, dialog, ipcMain, session } from 'electron';
import type { App } from 'electron';

import type { Logger } from '#x/log/create-logger.ts';

import type { AppInfo, McpStatus } from '#contract/ipc-contract.ts';

import { createIpcHandlers } from './ipc/create-ipc-handlers.ts';
import { registerIpcHandlers } from './ipc/register-ipc-handlers.ts';
import { sendEvent } from './ipc/send-event.ts';
import type { MainServices } from './main-services.ts';
import { launchMcpServer } from './mcp/launch-mcp-server.ts';
import { createMainWindow } from './window/create-main-window.ts';
import { hardenSession } from './window/harden-session.ts';
import { hardenWebContents } from './window/harden-web-contents.ts';

export interface StartAppOptions {
  readonly services: MainServices;
  readonly preloadPath: string;
  readonly indexHtmlPath: string;
  readonly mcpPort: number;
  readonly logger: Logger;
}

/**
 * Composes the running app once Electron is ready: worktree cleanup, security policy, IPC,
 * review progress, chat, URA and GitHub events, the clipboard, the main window (whose focus sets
 * the GitHub polling pace) and the MCP server; preliminary reviews are aborted and language
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
  const openWindow = (): void => {
    const window = createMainWindow(options);
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

  services.review.onProgress((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      sendEvent(window.webContents, 'review:progress', event);
    }
  });
  services.chat.onDelta((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      sendEvent(window.webContents, 'chat:delta', event);
    }
  });
  services.chat.onMessageUpdated((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      sendEvent(window.webContents, 'chat:message-updated', event);
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
  app.on('web-contents-created', (_event, contents) => {
    hardenWebContents(contents, logger);
  });
  // The renderer's own clipboard needs a permission the hardened session denies (ADR 0027).
  const platform = {
    writeClipboard: async (text: string): Promise<void> => clipboard.writeText(text),
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
  registerIpcHandlers(ipcMain, createIpcHandlers(services, readAppInfo(app), platform), {
    trustedUrl: pathToFileURL(options.indexHtmlPath).href,
    logger,
  });

  openWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
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
