import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { existsSync } from 'node:fs';

import { app, BrowserWindow, safeStorage, shell } from 'electron';

import { checkServerTrust } from '#internal/lsp/check-server-trust.ts';
import { createLogger } from '#x/log/create-logger.ts';

import { LinkInbox } from './links/link-inbox.ts';
import { createMainServices } from './create-main-services.ts';
import { createSystemEditorPlatform } from './editor/create-system-editor-platform.ts';
import { openAppDatabase } from './database/open-app-database.ts';
import { describeNodeRuntimeError } from './node-runtime/describe-node-runtime-error.ts';
import { resolveNodeRuntime } from './node-runtime/resolve-node-runtime.ts';
import { readDevelopmentOverrides } from './read-development-overrides.ts';
import { createShellEnvironments } from './shell-environment/create-shell-environments.ts';
import { readShellEnvironment } from './shell-environment/read-shell-environment.ts';
import { secureUserData } from './secure-user-data.ts';
import { startApp } from './start-app.ts';

const logger = createLogger('main');
const links = new LinkInbox();

// macOS delivers beuve:// links as `open-url`, possibly before `ready` (ADR 0098).
app.on('open-url', (event, url) => {
  event.preventDefault();
  links.push(url);
});

if (app.requestSingleInstanceLock()) {
  // Elsewhere a link starts beuve, or reaches the running one, as an argument.
  app.on('second-instance', (_event, argv): void => {
    focusExistingWindow();
    for (const argument of argv) {
      links.push(argument);
    }
  });
  for (const argument of process.argv) {
    links.push(argument);
  }
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
    const nodeRuntime = await resolveNodeRuntime({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      pathVariable: process.env['PATH'],
    });
    if (nodeRuntime.ok) {
      logger.info('node runtime for the language server', { ...nodeRuntime.value });
    } else {
      logger.error('no node runtime for the language server', {
        error: nodeRuntime.error,
        message: describeNodeRuntimeError(nodeRuntime.error),
      });
    }
    // The environment language servers run in is the one the reviewer's login shell gives, as in an
    // IDE (ADR 0111): read once now, and per checkout. Not when a terminal started beuve (it
    // already has that environment) and not on Windows.
    let nodeCommand: string | undefined;
    if (nodeRuntime.ok) {
      nodeCommand = nodeRuntime.value.command;
    }
    const shellEnvironments = createShellEnvironments({
      processEnvironment: process.env,
      shell: process.env['SHELL'],
      nodeCommand,
      home: os.homedir(),
      shouldRead: process.platform !== 'win32' && !process.stdout.isTTY,
      read: readShellEnvironment,
      trust: checkServerTrust,
      logger,
    });
    startApp(app, {
      services: createMainServices({
        db,
        logger,
        worktreeRoot,
        reviewEditsRoot: path.join(userData, 'review-edits'),
        nodeRuntime,
        shellEnvironments,
        editor: {
          settingsPath,
          platform: createSystemEditorPlatform({
            openExternal: async (url) => {
              return shell.openExternal(url);
            },
            ...(editorLaunchLog !== undefined && { launchLog: editorLaunchLog }),
          }),
        },
        display: { settingsPath },
        terminal: { version: app.getVersion() },
        models: {
          settingsPath,
          secretsPath: path.join(userData, 'model-secrets.json'),
          cipher: {
            isAvailable: async () => {
              return safeStorage.isAsyncEncryptionAvailable();
            },
            encrypt: async (plainText) => {
              return safeStorage.encryptStringAsync(plainText);
            },
            decrypt: async (encrypted) => {
              const decrypted = await safeStorage.decryptStringAsync(encrypted);
              return decrypted.result;
            },
            backend: () => {
              if (
                process.platform === 'linux' &&
                safeStorage.getSelectedStorageBackend() === 'basic_text'
              ) {
                return 'basic';
              }
              return 'os';
            },
          },
          ...bundledClaudeCode(),
        },
        shell: { openExternal: async (url) => shell.openExternal(url) },
        github: {
          settingsPath,
          openExternal: async (url) => {
            return shell.openExternal(url);
          },
          ...(githubApiBase !== undefined && { apiBase: githubApiBase }),
        },
        syntax: { wasmDirectory: path.join(import.meta.dirname, 'wasm') },
      }),
      preloadPath: path.join(import.meta.dirname, '../preload/index.cjs'),
      indexHtmlPath: path.join(import.meta.dirname, '../ui/index.html'),
      sheetPreloadPath: path.join(import.meta.dirname, '../preload/sheet-preload.cjs'),
      sheetHtmlPath: path.join(import.meta.dirname, '../ui/sheet.html'),
      settingsPreloadPath: path.join(import.meta.dirname, '../preload/settings-preload.cjs'),
      settingsHtmlPath: path.join(import.meta.dirname, '../ui/settings.html'),
      links,
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
function bundledClaudeCode(): BundledClaudeCode {
  if (!app.isPackaged) {
    return { hasBundledClaudeCode: true };
  }
  const binary = path.join(
    process.resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    '@anthropic-ai',
    `claude-agent-sdk-${process.platform}-${process.arch}`,
    claudeExecutableName(),
  );
  if (existsSync(binary)) {
    return { bundledClaudeCodePath: binary, hasBundledClaudeCode: true };
  }
  return { hasBundledClaudeCode: false };
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

/** Where the bundled Claude Code binary is, when the app ships one it can run. */
interface BundledClaudeCode {
  bundledClaudeCodePath?: string;
  hasBundledClaudeCode: boolean;
}

function claudeExecutableName(): string {
  if (process.platform === 'win32') {
    return 'claude.exe';
  }
  return 'claude';
}
