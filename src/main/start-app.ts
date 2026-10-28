import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { BrowserWindow, ipcMain, session } from 'electron';
import type { App } from 'electron';

import type { Logger } from '#pkg/logger/create-logger.ts';

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
 * Composes the running app once Electron is ready: worktree cleanup, security policy, IPC, the
 * main window and the MCP server; language servers are disposed before quitting. Call from `app.once('ready')`; never awaited at top level (see CLAUDE.md).
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
  };

  void services.pruneWorktrees();
  hardenSession(session.defaultSession);
  app.on('web-contents-created', (_event, contents) => {
    hardenWebContents(contents, logger);
  });
  registerIpcHandlers(ipcMain, createIpcHandlers(services, readAppInfo(app)), {
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
