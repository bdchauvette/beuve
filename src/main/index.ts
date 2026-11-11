import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { existsSync } from 'node:fs';

import { app, BrowserWindow, dialog, safeStorage, shell } from 'electron';

import { checkServerTrust } from '#internal/lsp/check-server-trust.ts';
import { createLogger } from '#x/log/create-logger.ts';
import type { LogSink } from '#x/log/create-logger.ts';
import { openLogFile } from '#x/log/open-log-file.ts';
import type { LogFileOptions } from '#x/log/open-log-file.ts';

import { LinkInbox } from './links/link-inbox.ts';
import { createMainServices } from './create-main-services.ts';
import { createSystemEditorPlatform } from './editor/create-system-editor-platform.ts';
import { openAppDatabase } from './database/open-app-database.ts';
import type { MovedDatabase } from './database/open-app-database.ts';
import { describeNodeRuntimeError } from './node-runtime/describe-node-runtime-error.ts';
import { resolveNodeRuntime } from './node-runtime/resolve-node-runtime.ts';
import { readDevelopmentOverrides } from './read-development-overrides.ts';
import { createLanguageServerRegistry } from './language-servers/create-language-server-registry.ts';
import { languageServersConfigPaths } from './language-servers/language-servers-config-paths.ts';
import { createShellEnvironments } from './shell-environment/create-shell-environments.ts';
import { readShellEnvironment } from './shell-environment/read-shell-environment.ts';
import { secureUserData } from './secure-user-data.ts';
import { startApp } from './start-app.ts';

/** Set once this instance holds the single-instance lock, so a second launch never rotates it. */
let logFile: LogSink | undefined;
const logger = createLogger('main', {
  sink: (line) => {
    process.stderr.write(`${line}\n`);
    logFile?.(line);
  },
});
const links = new LinkInbox();

// macOS delivers beuve:// links as `open-url`, possibly before `ready` (ADR 0098).
app.on('open-url', (event, url) => {
  event.preventDefault();
  links.push(url);
});

if (app.requestSingleInstanceLock()) {
  // A launch from Finder or the Dock has no terminal: the file is where Help › Show Log File points.
  logFile = openLogFile(logFilePaths());
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
    let movedDatabase: MovedDatabase | undefined;
    const db = openAppDatabase(path.join(userData, 'beuve.db'), {
      onMovedAside: (moved) => {
        logger.warn('database schema drifted; set it aside and started a new one', { ...moved });
        movedDatabase = moved;
      },
    });
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
    const languageServerPaths = languageServersConfigPaths({
      xdgConfigHome: process.env['XDG_CONFIG_HOME'],
      home: os.homedir(),
      userData,
    });
    const languageServers = await createLanguageServerRegistry({
      paths: languageServerPaths,
      home: os.homedir(),
      logger,
    });
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
        languageServers,
        languageServerConfig: {
          paths: languageServerPaths,
          openPath: async (file) => {
            return shell.openPath(file);
          },
          logger,
        },
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
      logPath: logFilePaths().path,
      logger,
    });
    if (movedDatabase !== undefined) {
      void showMovedDatabaseNotice(movedDatabase);
    }
  } catch (error: unknown) {
    logger.error('startup failed', { error });
    app.exit(1);
  }
}

/** `main.log` in the platform's log directory (`~/Library/Logs/beuve` on macOS), and the last run's. */
function logFilePaths(): LogFileOptions {
  const directory = app.getPath('logs');
  return {
    path: path.join(directory, 'main.log'),
    previousPath: path.join(directory, 'main.previous.log'),
  };
}

/** Says once why the reviews are gone and where the old database went (ADR 0006 amendment). */
async function showMovedDatabaseNotice(moved: MovedDatabase): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    message: 'beuve started a new database',
    detail: `The old one was made by an earlier build whose schema this build doesn’t match (${moved.objects.join(', ')}), so beuve moved it to ${moved.path} and started over. Staged notes and chat in it are not lost, but this build can’t read them.`,
    buttons: ['Show Old Database', 'OK'],
    defaultId: 1,
  });
  if (response === 0) {
    shell.showItemInFolder(moved.path);
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
