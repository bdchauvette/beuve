import path from 'node:path';
import process from 'node:process';

import { app, BrowserWindow } from 'electron';

import { createLogger } from '#pkg/logger/create-logger.ts';

import { createMainServices } from './create-main-services.ts';
import { openAppDatabase } from './database/open-app-database.ts';
import { startApp } from './start-app.ts';

const logger = createLogger('main');
const defaultMcpPort = 47_291;

if (app.requestSingleInstanceLock()) {
  app.on('second-instance', focusExistingWindow);
  app.once('ready', () => {
    logger.info('beuve starting', {
      version: app.getVersion(),
      electron: process.versions.electron,
      userData: app.getPath('userData'),
    });
    void launch();
  });
} else {
  logger.info('another beuve instance is running; handing over');
  app.quit();
}

async function launch(): Promise<void> {
  try {
    const userData = app.getPath('userData');
    const worktreeRoot = path.join(userData, 'worktrees');
    const db = openAppDatabase(path.join(userData, 'beuve.db'));
    app.once('quit', () => {
      db.close();
    });
    await startApp(app, {
      services: createMainServices({
        db,
        logger,
        worktreeRoot,
        syntax: { wasmDirectory: path.join(import.meta.dirname, 'wasm') },
      }),
      preloadPath: path.join(import.meta.dirname, '../preload/index.cjs'),
      indexHtmlPath: path.join(import.meta.dirname, '../ui/index.html'),
      mcpPort: parsePort(process.env['BEUVE_MCP_PORT']) ?? defaultMcpPort,
      logger,
    });
  } catch (error: unknown) {
    logger.error('startup failed', { error });
    app.exit(1);
  }
}

function focusExistingWindow(): void {
  const [window] = BrowserWindow.getAllWindows();
  if (window === undefined) {
    return;
  }
  if (window.isMinimized()) {
    window.restore();
  }
  window.focus();
}

function parsePort(value: string | undefined): number | undefined {
  const port = Number(value);
  return value !== undefined && Number.isSafeInteger(port) && port >= 0 && port < 65_536
    ? port
    : undefined;
}
