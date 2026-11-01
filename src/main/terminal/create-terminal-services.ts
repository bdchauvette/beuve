import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type {
  IpcError,
  IpcResult,
  TerminalAckView,
  TerminalBacklogView,
  TerminalCloseRequest,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalListRequest,
  TerminalListView,
  TerminalOpenRequest,
  TerminalResizeRequest,
  TerminalView,
  TerminalWriteRequest,
} from '#contract/ipc-contract.ts';
import { OutputCoalescer } from '#internal/terminal/output-coalescer.ts';
import type { PtyProcess, PtySpawner } from '#internal/terminal/pty-process.ts';
import { ScrollbackBuffer } from '#internal/terminal/scrollback-buffer.ts';
import { terminalEnvironmentFrom } from '#internal/terminal/terminal-environment-from.ts';
import { terminalShellFrom } from '#internal/terminal/terminal-shell-from.ts';
import { errorFrom } from '#x/error/error-from.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';

import type { RequestOptions } from '../request-options.ts';
import { loadSession } from '../sessions/load-session.ts';
import { refreshSession } from '../sessions/refresh-session.ts';
import type { SessionContext } from '../sessions/session-context.ts';
import type { SessionWorktrees } from '../worktrees/create-session-worktrees.ts';
import { worktreeFailure } from '../worktrees/worktree-failure.ts';

/** Terminals in beuve's checkouts (ADR 0095), as the renderer and the composition root reach them. */
export interface TerminalServices {
  /** Starts the user's shell in the checkout of the session's head, which it keeps leased. */
  readonly open: (
    request: TerminalOpenRequest,
    options?: RequestOptions,
  ) => Promise<IpcResult<TerminalView>>;
  readonly list: (request: TerminalListRequest) => IpcResult<TerminalListView>;
  readonly write: (request: TerminalWriteRequest) => IpcResult<TerminalAckView>;
  readonly resize: (request: TerminalResizeRequest) => IpcResult<TerminalAckView>;
  /** Ends the shell if it runs and forgets the terminal and its output. */
  readonly close: (request: TerminalCloseRequest) => IpcResult<TerminalAckView>;
  readonly onData: (listener: (event: TerminalDataEvent) => void) => () => void;
  readonly onExit: (listener: (event: TerminalExitEvent) => void) => () => void;
  /** Ends every shell. Call once, on quit. */
  readonly dispose: () => void;
}

export interface TerminalServicesOptions {
  readonly context: SessionContext;
  readonly worktrees: SessionWorktrees;
  /** `node-pty` in the app; a fake in tests. */
  readonly spawn: PtySpawner;
  /** beuve's environment, which the terminal's is built from. */
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly platform: NodeJS.Platform;
  /** beuve's version, for `TERM_PROGRAM_VERSION`. */
  readonly version: string;
  /** Characters of output kept per terminal for a reloaded renderer. Defaults to 1 MiB. */
  readonly scrollbackLimit?: number;
  /** How long output waits to be batched. Defaults to 8 ms. */
  readonly outputDelay?: Temporal.Duration;
}

interface Terminal {
  readonly id: string;
  readonly sessionId: string;
  readonly headSha: string;
  readonly title: string;
  readonly process: PtyProcess;
  readonly scrollback: ScrollbackBuffer;
  readonly output: OutputCoalescer;
  /** The checkout's lease and the process's listeners, released when the shell ends. */
  readonly resources: DisposableStack;
  isRunning: boolean;
}

const defaultScrollbackLimit = 1024 * 1024;
const defaultOutputDelay = Temporal.Duration.from({ milliseconds: 8 });
const outputBatchLimit = 64 * 1024;

export function createTerminalServices(options: TerminalServicesOptions): TerminalServices {
  const { context, worktrees } = options;
  const terminals = new Map<string, Terminal>();
  const dataListeners = new Set<(event: TerminalDataEvent) => void>();
  const exitListeners = new Set<(event: TerminalExitEvent) => void>();

  const viewOf = (terminal: Terminal): TerminalView => {
    return {
      id: terminal.id,
      sessionId: terminal.sessionId,
      headSha: terminal.headSha,
      title: terminal.title,
      isRunning: terminal.isRunning,
    };
  };

  const backlogOf = (terminal: Terminal): TerminalBacklogView => {
    return {
      ...viewOf(terminal),
      backlog: terminal.scrollback.text,
      backlogEnd: terminal.scrollback.end,
    };
  };

  const find = (terminalId: string): IpcResult<Terminal> => {
    const terminal = terminals.get(terminalId);
    if (terminal === undefined) {
      return err({ code: 'not-found', message: 'no such terminal' });
    }
    return ok(terminal);
  };

  const findRunning = (terminalId: string): IpcResult<Terminal> => {
    const found = find(terminalId);
    if (found.ok && !found.value.isRunning) {
      return err({ code: 'refused', message: 'The shell has ended.' });
    }
    return found;
  };

  const forward = (terminal: Terminal, text: string): void => {
    terminal.scrollback.append(text);
    const event = { terminalId: terminal.id, data: text, end: terminal.scrollback.end };
    for (const listener of dataListeners) {
      listener(event);
    }
  };

  const markEnded = (terminal: Terminal, exit: ExitOf): void => {
    if (!terminal.isRunning) {
      return;
    }
    terminal.isRunning = false;
    terminal.output.flush();
    terminal.resources.dispose();
    for (const listener of exitListeners) {
      listener({ terminalId: terminal.id, exitCode: exit.exitCode, signal: exit.signal });
    }
  };

  const start = async (request: StartRequest): Promise<IpcResult<Terminal>> => {
    const { session, repositoryPath, checkout, size } = request;
    const shell = terminalShellFrom({
      shell: options.environment['SHELL'],
      platform: options.platform,
    });
    const env = terminalEnvironmentFrom({
      inherited: options.environment,
      checkout,
      headSha: session.headSha,
      sessionId: session.id,
      repositoryPath,
      version: options.version,
    });
    let process: PtyProcess;
    try {
      process = await options.spawn({
        file: shell.file,
        args: shell.args,
        cwd: checkout,
        env,
        size,
      });
    } catch (error) {
      context.logger.warn('terminal: could not start the shell', {
        shell: shell.file,
        error: errorFrom(error).message,
      });
      return err({
        code: 'unsupported',
        message: `The terminal could not start ${shell.file}: ${errorFrom(error).message}`,
      });
    }
    const terminal: Terminal = {
      id: randomUUID(),
      sessionId: session.id,
      headSha: session.headSha,
      title: path.basename(shell.file),
      process,
      scrollback: new ScrollbackBuffer(options.scrollbackLimit ?? defaultScrollbackLimit),
      output: new OutputCoalescer({
        delay: options.outputDelay ?? defaultOutputDelay,
        limit: outputBatchLimit,
        flush: (text): void => {
          forward(terminal, text);
        },
      }),
      resources: request.resources,
      isRunning: true,
    };
    terminal.resources.defer(
      process.onData((data) => {
        terminal.output.write(data);
      }),
    );
    terminal.resources.defer(
      process.onExit((exit) => {
        markEnded(terminal, exit);
      }),
    );
    return ok(terminal);
  };

  return {
    open: async (request, requestOptions = {}): Promise<IpcResult<TerminalView>> => {
      const { signal } = requestOptions;
      const loaded = loadSession(context, request.sessionId);
      if (!loaded.ok) {
        return loaded;
      }
      const refreshed = await refreshSession(context, loaded.value, { signal });
      if (!refreshed.ok) {
        return refreshed;
      }
      const { repository, session } = refreshed.value;
      if (session.headSha !== request.expectedHeadSha) {
        return err(staleHead());
      }
      using resources = new DisposableStack();
      const leased = await worktrees.acquire(
        repository,
        { kind: 'session-head', sessionId: session.id, headSha: session.headSha },
        { signal },
      );
      if (!leased.ok) {
        return worktreeFailure(context.logger, leased.error);
      }
      resources.use(leased.value);
      const started = await start({
        session,
        repositoryPath: session.source.repoPath,
        checkout: leased.value.path,
        size: { cols: request.cols, rows: request.rows },
        resources: resources.move(),
      });
      if (!started.ok) {
        return started;
      }
      terminals.set(started.value.id, started.value);
      return ok(viewOf(started.value));
    },
    list: ({ sessionId }): IpcResult<TerminalListView> => {
      const own: TerminalBacklogView[] = [];
      for (const terminal of terminals.values()) {
        if (terminal.sessionId === sessionId) {
          own.push(backlogOf(terminal));
        }
      }
      return ok({ terminals: own });
    },
    write: ({ terminalId, data }): IpcResult<TerminalAckView> => {
      const found = findRunning(terminalId);
      if (!found.ok) {
        return found;
      }
      found.value.process.write(data);
      return ok({ terminalId });
    },
    resize: ({ terminalId, cols, rows }): IpcResult<TerminalAckView> => {
      const found = findRunning(terminalId);
      if (!found.ok) {
        return found;
      }
      found.value.process.resize({ cols, rows });
      return ok({ terminalId });
    },
    close: ({ terminalId }): IpcResult<TerminalAckView> => {
      const found = find(terminalId);
      if (!found.ok) {
        return found;
      }
      terminals.delete(terminalId);
      endShell(found.value);
      return ok({ terminalId });
    },
    onData: (listener): (() => void) => {
      dataListeners.add(listener);
      return (): void => {
        dataListeners.delete(listener);
      };
    },
    onExit: (listener): (() => void) => {
      exitListeners.add(listener);
      return (): void => {
        exitListeners.delete(listener);
      };
    },
    dispose: (): void => {
      for (const terminal of terminals.values()) {
        endShell(terminal);
      }
      terminals.clear();
      dataListeners.clear();
      exitListeners.clear();
    },
  };
}

/** What `start` needs besides the options: the session head, its checkout and the held lease. */
interface StartRequest {
  readonly session: { readonly id: string; readonly headSha: string };
  readonly repositoryPath: string;
  readonly checkout: string;
  readonly size: { readonly cols: number; readonly rows: number };
  readonly resources: DisposableStack;
}

interface ExitOf {
  readonly exitCode: number;
  readonly signal: number | undefined;
}

/** Hangs up the shell if it runs, drops what is still waiting to be sent, and releases the lease. */
function endShell(terminal: Terminal): void {
  if (terminal.isRunning) {
    terminal.isRunning = false;
    terminal.process.kill();
  }
  terminal.resources.dispose();
}

function staleHead(): IpcError {
  return { code: 'stale-review', message: 'The head moved; showing the new commits.' };
}
