import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { JsonRpcConnection } from '#jsonrpc/json-rpc-connection.ts';
import type { JsonRpcHandlerOutcome, JsonRpcRequestError } from '#jsonrpc/json-rpc-connection.ts';
import type { Logger } from '#x/log/create-logger.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { answerServerRequest } from './answer-server-request.ts';
import { clientCapabilities } from './client-capabilities.ts';
import type { LspError } from './lsp-error.ts';
import type { LspServerCapabilities } from './lsp-protocol.ts';
import { parseServerCapabilities } from './parse-server-capabilities.ts';
import type { WorkspaceRoot } from './resolve-workspace-root.ts';
import type { ServerDefinition } from './server-definition.ts';
import { tailOf } from '#x/text/tail-of.ts';

/** How a server process ended. `expected` is true when beuve asked it to stop. */
export interface ServerExit {
  readonly exitCode: number | undefined;
  readonly signal: string | undefined;
  readonly expected: boolean;
}

export interface ServerRequestOptions {
  readonly timeout?: Temporal.Duration;
  readonly signal?: AbortSignal | undefined;
}

/** A running, initialized language server. The seam `ServerSession` builds on (and tests fake). */
export interface LanguageServer {
  readonly serverId: string;
  readonly root: WorkspaceRoot;
  readonly pid: number | undefined;
  readonly capabilities: LspServerCapabilities;
  readonly request: (
    method: string,
    params: unknown,
    options?: ServerRequestOptions,
  ) => Promise<Result<unknown, LspError>>;
  readonly notify: (method: string, params: unknown) => void;
  /**
   * Receives every server notification except log messages. Notifications that arrive before a
   * listener is set are queued and delivered when it is.
   */
  readonly setNotificationListener: (listener: (method: string, params: unknown) => void) => void;
  /** Settles once, when the process has exited. */
  readonly exited: Promise<ServerExit>;
  /** `shutdown`, `exit`, then signals if needed; also reaps the server's process group. Idempotent. */
  readonly shutdown: () => Promise<void>;
}

export interface StartLanguageServerOptions {
  readonly definition: ServerDefinition;
  readonly root: WorkspaceRoot;
  /** Absolute path of the executable (see `findServerCommand`). */
  readonly commandPath: string;
  readonly env: Readonly<Record<string, string>>;
  readonly logger?: Logger;
  /** Default per-request timeout. Defaults to 15 s. */
  readonly requestTimeout?: Temporal.Duration;
  /** For the `initialize` handshake. Defaults to 30 s. */
  readonly initializeTimeout?: Temporal.Duration;
  /** For each step of shutdown. Defaults to 2 s. */
  readonly shutdownTimeout?: Temporal.Duration;
}

const contentModified = -32_801;
const serverCancelled = -32_802;
const stderrTailBytes = 4096;

/**
 * Spawns a language server (no shell, `cwd` = root, minimal environment, its own process group on
 * POSIX), performs the `initialize`/`initialized` handshake and returns a handle. Server requests
 * are answered read-only (`answerServerRequest`).
 */
export async function startLanguageServer(
  options: StartLanguageServerOptions,
): Promise<Result<LanguageServer, LspError>> {
  const { definition, root, logger } = options;
  const serverId = definition.id;
  const isOwnGroup = process.platform !== 'win32';
  const spawned = await spawnServer(options, isOwnGroup);
  if (!spawned.ok) {
    return spawned;
  }
  const child = spawned.value;
  let stderrTail = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderrTail = tailOf(stderrTail + chunk, stderrTailBytes);
    logger?.debug('lsp: server stderr', { serverId, text: chunk.trimEnd() });
  });

  let isExpected = false;
  let hasExited = false;
  const signalGroup = (signal: NodeJS.Signals): void => {
    try {
      if (isOwnGroup && child.pid !== undefined) {
        process.kill(-child.pid, signal);
      } else {
        child.kill(signal);
      }
    } catch {
      // The group is already gone.
    }
  };
  const exited = new Promise<ServerExit>((resolve) => {
    child.once('exit', (code, signal) => {
      hasExited = true;
      connection.close();
      signalGroup('SIGKILL');
      const exit = {
        exitCode: code ?? undefined,
        signal: signal ?? undefined,
        expected: isExpected,
      };
      logger?.[isExpected ? 'debug' : 'warn']('lsp: server exited', { serverId, root, ...exit });
      resolve(exit);
    });
  });

  let queued: { method: string; params: unknown }[] | undefined = [];
  let listener: ((method: string, params: unknown) => void) | undefined;
  const workspaceFolders = [{ uri: pathToFileURL(root).href, name: path.basename(root) }];
  const settings = definition.settings ?? {};
  const connection = new JsonRpcConnection({
    input: child.stdout,
    output: child.stdin,
    cancelMethod: '$/cancelRequest',
    defaultTimeout: options.requestTimeout ?? Temporal.Duration.from({ seconds: 15 }),
    ...(logger !== undefined && { logger }),
    onRequest: (method, params): JsonRpcHandlerOutcome => {
      return answerServerRequest(method, params, { settings, workspaceFolders });
    },
    onNotification: (method, params): void => {
      if (method === 'window/logMessage' || method === 'window/showMessage') {
        logger?.debug('lsp: server message', { serverId, method, params });
      } else if (listener === undefined) {
        queued?.push({ method, params });
      } else {
        listener(method, params);
      }
    },
  });

  const shutdownStep = options.shutdownTimeout ?? Temporal.Duration.from({ seconds: 2 });
  const hasExitedInTime = async (): Promise<boolean> => {
    if (hasExited) {
      return true;
    }
    const { promise: timedOut, resolve } = Promise.withResolvers<boolean>();
    using _timer = setTimeout(() => {
      resolve(false);
    }, shutdownStep.total('milliseconds'));
    return await Promise.race([
      (async (): Promise<boolean> => {
        await exited;
        return true;
      })(),
      timedOut,
    ]);
  };
  let stopping: Promise<void> | undefined;
  const shutdown = async (): Promise<void> => {
    stopping ??= (async (): Promise<void> => {
      isExpected = true;
      if (!hasExited) {
        await connection.request('shutdown', undefined, { timeout: shutdownStep });
        connection.notify('exit');
        child.stdin.end();
      }
      if (await hasExitedInTime()) {
        return;
      }

      signalGroup('SIGTERM');
      if (await hasExitedInTime()) {
        return;
      }

      signalGroup('SIGKILL');
      await hasExitedInTime();
    })();
    return stopping;
  };

  const request = async (
    method: string,
    params: unknown,
    requestOptions: ServerRequestOptions = {},
  ): Promise<Result<unknown, LspError>> => {
    let outcome = await connection.request(method, params, requestOptions);
    if (!outcome.ok && isRetryable(outcome.error)) {
      outcome = await connection.request(method, params, requestOptions);
    }
    if (outcome.ok) {
      return outcome;
    }
    return err(lspErrorFrom(serverId, outcome.error));
  };

  const initialized = await initialize(connection, options, workspaceFolders);
  if (!initialized.ok) {
    await shutdown();
    const message = `${initialized.error}${stderrTail === '' ? '' : `\n${stderrTail.trim()}`}`;
    return err({ kind: 'server-start-failed', serverId, message });
  }
  logger?.info('lsp: server started', { serverId, root, pid: child.pid });
  return ok({
    serverId,
    root,
    pid: child.pid,
    capabilities: initialized.value,
    request,
    notify: (method, params): void => {
      connection.notify(method, params);
    },
    setNotificationListener: (next): void => {
      listener = next;
      const pending = queued ?? [];
      queued = undefined;
      for (const { method, params } of pending) {
        next(method, params);
      }
    },
    exited,
    shutdown,
  });
}

async function spawnServer(
  options: StartLanguageServerOptions,
  isOwnGroup: boolean,
): Promise<Result<ChildProcessWithoutNullStreams, LspError>> {
  const { definition, root, commandPath, env } = options;
  return new Promise((resolve) => {
    const child = spawn(commandPath, [...definition.args], {
      cwd: root,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
      detached: isOwnGroup,
    });
    child.stdin.on('error', () => {
      // EPIPE after the server died; the exit handler reports it.
    });
    const onError = (error: Error): void => {
      resolve(
        err({ kind: 'server-start-failed', serverId: definition.id, message: error.message }),
      );
    };
    child.once('error', onError);
    child.once('spawn', () => {
      child.off('error', onError);
      child.on('error', (error) => {
        options.logger?.warn('lsp: server process error', { serverId: definition.id, error });
      });
      resolve(ok(child));
    });
  });
}

async function initialize(
  connection: JsonRpcConnection,
  options: StartLanguageServerOptions,
  workspaceFolders: readonly { uri: string; name: string }[],
): Promise<Result<LspServerCapabilities, string>> {
  const { definition, root } = options;
  const result = await connection.request(
    'initialize',
    {
      processId: process.pid,
      clientInfo: { name: 'beuve' },
      locale: 'en',
      rootPath: root,
      rootUri: pathToFileURL(root).href,
      workspaceFolders,
      capabilities: clientCapabilities,
      initializationOptions: definition.initializationOptions,
      trace: 'off',
    },
    { timeout: options.initializeTimeout ?? Temporal.Duration.from({ seconds: 30 }) },
  );
  if (!result.ok) {
    return err(`initialize failed: ${describe(result.error)}`);
  }
  const capabilities = parseServerCapabilities(result.value);
  if (capabilities === undefined) {
    return err('initialize returned no capabilities');
  }
  connection.notify('initialized', {});
  if (definition.settings !== undefined) {
    connection.notify('workspace/didChangeConfiguration', { settings: definition.settings });
  }
  return ok(capabilities);
}

function isRetryable(error: JsonRpcRequestError): boolean {
  return (
    error.kind === 'remote-error' &&
    (error.code === contentModified || error.code === serverCancelled)
  );
}

function lspErrorFrom(serverId: string, error: JsonRpcRequestError): LspError {
  switch (error.kind) {
    case 'timeout': {
      return { kind: 'request-timeout', method: error.method, timeout: error.timeout };
    }
    case 'cancelled': {
      return { kind: 'request-cancelled', method: error.method };
    }
    case 'closed': {
      return {
        kind: 'server-exited',
        serverId,
        exitCode: undefined,
        signal: undefined,
        restartsExhausted: false,
      };
    }
    case 'remote-error': {
      return {
        kind: 'request-failed',
        method: error.method,
        code: error.code,
        message: error.message,
      };
    }
  }
}

function describe(error: JsonRpcRequestError): string {
  switch (error.kind) {
    case 'timeout': {
      return `timed out after ${error.timeout.toString()}`;
    }
    case 'cancelled': {
      return 'cancelled';
    }
    case 'closed': {
      return 'the server closed the connection';
    }
    case 'remote-error': {
      return `${error.message} (${String(error.code)})`;
    }
  }
}
