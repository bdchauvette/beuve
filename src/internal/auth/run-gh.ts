import { spawn } from 'node:child_process';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';
import { tailOf } from '#x/text/tail-of.ts';

export interface GhInvocation {
  readonly command: string;
  /** Before gh's own arguments, e.g. a script when `command` is a Node binary (tests). */
  readonly leadingArgs?: readonly string[];
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  /** An absolute directory unrelated to any repository under review. */
  readonly cwd: string;
  readonly timeout: Temporal.Duration;
  /** Fail with `output-too-large` past this many bytes of stdout. Defaults to 1 MiB. */
  readonly maxOutputBytes?: number;
}

export interface GhExit {
  readonly exitCode: number | undefined;
  readonly signal: string | undefined;
  /** Holds the token for `auth token`: never log it. */
  readonly stdout: string;
  /** A tail of at most 4 KiB. */
  readonly stderr: string;
}

export type GhRunFailure =
  | { readonly kind: 'not-found' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'output-too-large' }
  | { readonly kind: 'spawn-failed'; readonly message: string };

const defaultMaxOutputBytes = 1024 * 1024;
const stderrTailChars = 4096;

/**
 * Runs `gh` once without a shell, stdin closed, in `cwd` with exactly `env`, and collects its
 * output. A timeout or an output flood kills it with SIGKILL. Never logs: stdout may be a token.
 */
export async function runGh(invocation: GhInvocation): Promise<Result<GhExit, GhRunFailure>> {
  const maxOutputBytes = invocation.maxOutputBytes ?? defaultMaxOutputBytes;
  const child = spawn(invocation.command, [...(invocation.leadingArgs ?? []), ...invocation.args], {
    cwd: invocation.cwd,
    env: invocation.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    windowsHide: true,
  });
  let failure: GhRunFailure | undefined;
  const stop = (reason: GhRunFailure): void => {
    failure ??= reason;
    child.kill('SIGKILL');
  };
  using _timer = setTimeout(() => {
    stop({ kind: 'timeout' });
  }, invocation.timeout.total('milliseconds'));

  let stdout = '';
  let outputBytes = 0;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    outputBytes += Buffer.byteLength(chunk);
    if (outputBytes > maxOutputBytes) {
      stop({ kind: 'output-too-large' });
      return;
    }
    stdout += chunk;
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr = tailOf(stderr + chunk, stderrTailChars);
  });

  // Awaited, not returned: the timer must outlive the process.
  return await new Promise((resolve) => {
    child.once('error', (error: NodeJS.ErrnoException) => {
      resolve(
        err(
          error.code === 'ENOENT' || error.code === 'EACCES'
            ? { kind: 'not-found' }
            : { kind: 'spawn-failed', message: error.message },
        ),
      );
    });
    child.once('close', (code, signal) => {
      resolve(
        failure === undefined
          ? ok({ exitCode: code ?? undefined, signal: signal ?? undefined, stdout, stderr })
          : err(failure),
      );
    });
  });
}
