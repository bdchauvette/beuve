import { spawn } from 'node:child_process';
import path from 'node:path';

import type { Logger } from '#x/log/create-logger.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';
import { tailOf } from '#x/text/tail-of.ts';
import { Stopwatch } from '#x/time/stopwatch.ts';

import type { GitError } from './git-error.ts';
import { gitHardeningArgs } from './git-hardening-args.ts';
import { hardenedGitEnvironment } from './hardened-git-environment.ts';

/** One streamed git read. `args` start at the subcommand; hardening options are prepended. */
export interface GitStreamRequest {
  readonly cwd: string;
  readonly args: readonly string[];
  readonly gitBinary?: string;
  /** Stop git with SIGTERM after this long. Defaults to 30 s. */
  readonly timeout?: Temporal.Duration;
  /** Only reads stream (ADR 0079): an abort sends SIGTERM and the call fails with `aborted`. */
  readonly policy: { readonly kind: 'read' };
  readonly signal?: AbortSignal | undefined;
  /** Each chunk of stdout; `stop` ends git with SIGTERM and the call with `stopped`. */
  readonly onStdout: (chunk: Buffer) => 'more' | 'stop';
  readonly logger?: Logger;
}

const defaultTimeout = Temporal.Duration.from({ seconds: 30 });
const maxStderrChars = 64 * 1024;

/**
 * Runs git like `execGit` (no shell, the same hardening options and environment, SIGTERM only)
 * but hands stdout over as it arrives instead of buffering it, so a caller can stop once it has
 * enough. A non-zero exit is `command-failed` with git's exit code (`git grep` exits 1 when
 * nothing matched). Resolves only once git has exited. Never rejects.
 */
export async function streamGit(
  request: GitStreamRequest,
): Promise<Result<'complete' | 'stopped', GitError>> {
  type Closed =
    | { readonly kind: 'error'; readonly error: NodeJS.ErrnoException }
    | {
        readonly kind: 'closed';
        readonly code: number | null;
        readonly signal: NodeJS.Signals | null;
      };
  if (!path.isAbsolute(request.cwd)) {
    return err({ kind: 'invalid-argument', argument: request.cwd, reason: 'cwd must be absolute' });
  }
  const withNul = request.args.find((arg) => arg.includes('\0'));
  if (withNul !== undefined) {
    return err({ kind: 'invalid-argument', argument: withNul, reason: 'contains a NUL byte' });
  }
  if (request.signal?.aborted === true) {
    return err({ kind: 'aborted', args: request.args });
  }
  const gitBinary = request.gitBinary ?? 'git';
  const timeout = request.timeout ?? defaultTimeout;
  const stopwatch = new Stopwatch();
  // eslint-disable-next-line local/forward-abort-signal -- `onAbort` below stops git and records why.
  const child = spawn(gitBinary, [...gitHardeningArgs, ...request.args], {
    cwd: request.cwd,
    env: hardenedGitEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    shell: false,
  });
  using cleanup = new DisposableStack();
  let ending: 'stopped' | 'aborted' | 'timeout' | undefined;
  const stop = (why: 'stopped' | 'aborted' | 'timeout'): void => {
    if (ending !== undefined) {
      return;
    }

    ending = why;
    child.kill('SIGTERM');
  };
  const onAbort = (): void => {
    stop('aborted');
  };
  request.signal?.addEventListener('abort', onAbort, { once: true });
  cleanup.defer(() => {
    request.signal?.removeEventListener('abort', onAbort);
  });
  const timer = setTimeout(() => {
    stop('timeout');
  }, timeout.total('milliseconds'));
  cleanup.defer(() => {
    clearTimeout(timer);
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr = tailOf(stderr + chunk, maxStderrChars);
  });
  child.stdout.on('data', (chunk: Buffer) => {
    if (ending === undefined && request.onStdout(chunk) === 'stop') {
      stop('stopped');
    }
  });
  const closed = await new Promise<Closed>((resolve) => {
    child.once('error', (error: NodeJS.ErrnoException) => {
      resolve({ kind: 'error', error });
    });
    child.once('close', (code, signal) => {
      resolve({ kind: 'closed', code, signal });
    });
  });
  request.logger?.debug('git', {
    args: request.args,
    cwd: request.cwd,
    duration: stopwatch.elapsed(),
    ending: ending ?? 'complete',
  });
  if (closed.kind === 'error') {
    return closed.error.code === 'ENOENT'
      ? err({ kind: 'git-not-found', gitBinary })
      : err({
          kind: 'command-failed',
          args: request.args,
          exitCode: undefined,
          signal: undefined,
          stdout: '',
          stderr: closed.error.message,
        });
  }
  switch (ending) {
    case 'stopped': {
      return ok('stopped');
    }
    case 'aborted': {
      return err({ kind: 'aborted', args: request.args });
    }
    case 'timeout': {
      return err({ kind: 'timeout', args: request.args, timeout });
    }
    case undefined: {
      return closed.code === 0
        ? ok('complete')
        : err({
            kind: 'command-failed',
            args: request.args,
            exitCode: closed.code ?? undefined,
            signal: closed.signal ?? undefined,
            stdout: '',
            stderr: stderr.trim(),
          });
    }
  }
}
