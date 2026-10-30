import path from 'node:path';
import process from 'node:process';

import { existsSync } from 'node:fs';

import { app, BrowserWindow, safeStorage, shell } from 'electron';

import { createLogger } from '#x/log/create-logger.ts';

import { createMainServices } from './create-main-services.ts';
import { createSystemEditorPlatform } from './editor/create-system-editor-platform.ts';
import { openAppDatabase } from './database/open-app-database.ts';
import { readDevelopmentOverrides } from './read-development-overrides.ts';
import { secureUserData } from './secure-user-data.ts';
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
    await secureUserData(userData, logger);
    const worktreeRoot = path.join(userData, 'worktrees');
    const db = openAppDatabase(path.join(userData, 'beuve.db'));
    const settingsPath = path.join(userData, 'settings.json');
    // Fakes for development (ADR 0040); a packaged app applies none of them (ADR 0048).
    const { githubApiBase, editorLaunchLog, ignored } = readDevelopmentOverrides(
      app.isPackaged,
      process.env,
    );
    if (ignored.length > 0) {
      logger.warn('ignoring development overrides in a packaged app', { variables: ignored });
    }
    if (githubApiBase !== undefined) {
      logger.warn('using a development GitHub API', { url: githubApiBase.href });
    }
    app.once('quit', () => {
      db.close();
    });
    await startApp(app, {
      services: createMainServices({
        db,
        logger,
        worktreeRoot,
        editor: {
          settingsPath,
          platform: createSystemEditorPlatform({
            openExternal: async (url) => shell.openExternal(url),
            ...(editorLaunchLog !== undefined && { launchLog: editorLaunchLog }),
          }),
        },
        display: { settingsPath },
        models: {
          settingsPath,
          secretsPath: path.join(userData, 'model-secrets.json'),
          cipher: {
            isAvailable: async () => safeStorage.isAsyncEncryptionAvailable(),
            encrypt: async (plainText) => safeStorage.encryptStringAsync(plainText),
            decrypt: async (encrypted) => {
              const decrypted = await safeStorage.decryptStringAsync(encrypted);
              return decrypted.result;
            },
            backend: () =>
              process.platform === 'linux' &&
              safeStorage.getSelectedStorageBackend() === 'basic_text'
                ? 'basic'
                : 'os',
          },
          ...bundledClaudeCode(),
        },
        trace: { settingsPath, temporaryDirectory: path.join(userData, 'trace') },
        shell: { openExternal: async (url) => shell.openExternal(url) },
        github: {
          settingsPath,
          openExternal: async (url) => shell.openExternal(url),
          ...(githubApiBase !== undefined && { apiBase: githubApiBase }),
        },
        syntax: { wasmDirectory: path.join(import.meta.dirname, 'wasm') },
        impactWorkerUrl: path.join(import.meta.dirname, 'impact-worker.js'),
      }),
      preloadPath: path.join(import.meta.dirname, '../preload/index.cjs'),
      indexHtmlPath: path.join(import.meta.dirname, '../ui/index.html'),
      sheetPreloadPath: path.join(import.meta.dirname, '../preload/sheet-preload.cjs'),
      sheetHtmlPath: path.join(import.meta.dirname, '../ui/sheet.html'),
      settingsPreloadPath: path.join(import.meta.dirname, '../preload/settings-preload.cjs'),
      settingsHtmlPath: path.join(import.meta.dirname, '../ui/settings.html'),
      mcpPort: parsePort(process.env['BEUVE_MCP_PORT']) ?? defaultMcpPort,
      logger,
    });
  } catch (error: unknown) {
    logger.error('startup failed', { error });
    app.exit(1);
  }
}

/**
 * The Claude Code binary packaged for the Agent SDK's Bundled option (ADR 0069, 0070), unpacked
 * from the archive so it can run. Unpackaged, the SDK finds its own in `node_modules`.
 */
function bundledClaudeCode(): { bundledClaudeCodePath?: string; hasBundledClaudeCode: boolean } {
  if (!app.isPackaged) {
    return { hasBundledClaudeCode: true };
  }
  const binary = path.join(
    process.resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    '@anthropic-ai',
    `claude-agent-sdk-${process.platform}-${process.arch}`,
    process.platform === 'win32' ? 'claude.exe' : 'claude',
  );
  return existsSync(binary)
    ? { bundledClaudeCodePath: binary, hasBundledClaudeCode: true }
    : { hasBundledClaudeCode: false };
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
