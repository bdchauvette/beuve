import { execFile } from 'node:child_process';
import type { ExecFileException } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';

import type { Logger } from '#x/log/create-logger.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';
import { Stopwatch } from '#x/time/stopwatch.ts';

import type { GitError } from './git-error.ts';
import { gitHardeningArgs } from './git-hardening-args.ts';
import { hardenedGitEnvironment } from './hardened-git-environment.ts';
import type { InterruptionPolicy } from './interruption-policy.ts';

/** One git invocation. `args` start at the subcommand; hardening options are prepended. */
export interface GitRequest {
  /** Absolute directory git runs in. */
  readonly cwd: string;
  readonly args: readonly string[];
  /** Executable to run. Defaults to `git` on `PATH`. */
  readonly gitBinary?: string;
  /** Kill git after this long. Defaults to 30 s. */
  readonly timeout?: Temporal.Duration;
  /** Fail with `output-too-large` past this many bytes of stdout or stderr. Defaults to 64 MiB. */
  readonly maxBufferBytes?: number;
  /** Written to git's stdin, which is then closed. */
  readonly input?: string;
  /** What an abort of `signal` does: SIGTERM (`read`, `owned-write`) or nothing until git exits (`atomic`). */
  readonly policy: InterruptionPolicy;
  /** Interrupts git as `policy` says; the request then fails with `aborted`. */
  readonly signal?: AbortSignal | undefined;
  readonly logger?: Logger;
}

const defaultTimeout = Temporal.Duration.from({ seconds: 30 });
const defaultMaxBufferBytes = 64 * 1024 * 1024;

/**
 * Runs git directly (never through a shell) and returns its raw stdout. Inherited `GIT_*`
 * variables are dropped so the caller's environment can't redirect git to another repository,
 * prompts and pagers are disabled, and messages are forced to the C locale so failures can be
 * classified. An abort is handled as `request.policy` says (ADR 0079); either way the call
 * resolves only once git has exited, so its own cleanup is done. Git is only ever stopped with
 * SIGTERM, never SIGKILL, so it always removes its lock files. Never rejects.
 */
export async function execGit(request: GitRequest): Promise<Result<Buffer, GitError>> {
  const invalid = validateRequest(request);
  if (invalid !== undefined) {
    return err(invalid);
  }
  const { policy, signal } = request;
  const isAborted = (): boolean => signal?.aborted === true;
  if (isAborted()) {
    return err({ kind: 'aborted', args: request.args });
  }
  const gitBinary = request.gitBinary ?? 'git';
  const timeout = request.timeout ?? defaultTimeout;
  const maxBufferBytes = request.maxBufferBytes ?? defaultMaxBufferBytes;
  const stopwatch = new Stopwatch();
  const outcome = await execute(gitBinary, [...gitHardeningArgs, ...request.args], {
    cwd: request.cwd,
    timeout,
    maxBufferBytes,
    input: request.input,
    signal: interruptibleBy(policy, signal),
  });
  request.logger?.debug('git', {
    args: request.args,
    cwd: request.cwd,
    duration: stopwatch.elapsed(),
    exitCode: loggedExitCode(outcome.error),
  });
  if (outcome.error?.code === 'ABORT_ERR' && policy.kind === 'owned-write') {
    await policy.cleanup?.();
  }
  if (policy.kind === 'atomic' && isAborted()) {
    return err({ kind: 'aborted', args: request.args });
  }
  if (outcome.error === null) {
    return ok(outcome.stdout);
  }
  return err(
    await classifyFailure(outcome, {
      cwd: request.cwd,
      args: request.args,
      gitBinary,
      timeout,
      maxBufferBytes,
    }),
  );
}

function validateRequest(request: GitRequest): GitError | undefined {
  if (!path.isAbsolute(request.cwd)) {
    return { kind: 'invalid-argument', argument: request.cwd, reason: 'cwd must be absolute' };
  }
  const withNul = [request.cwd, ...request.args].find((arg) => arg.includes('\0'));
  if (withNul === undefined) {
    return undefined;
  }
  return { kind: 'invalid-argument', argument: withNul, reason: 'contains a NUL byte' };
}

interface ExecOutcome {
  readonly error: ExecFileException | null;
  readonly stdout: Buffer;
  readonly stderr: string;
}

/** How one git process runs: where, for how long, with what output cap, input and signal. */
interface ExecSettings {
  readonly cwd: string;
  readonly timeout: Temporal.Duration;
  readonly maxBufferBytes: number;
  readonly input: string | undefined;
  readonly signal: AbortSignal | undefined;
}

/** An `atomic` command runs to the end once started; the others stop on the signal. */
function interruptibleBy(
  policy: InterruptionPolicy,
  signal: AbortSignal | undefined,
): AbortSignal | undefined {
  if (policy.kind === 'atomic') {
    return undefined;
  }
  return signal;
}

async function execute(
  file: string,
  args: readonly string[],
  options: ExecSettings,
): Promise<ExecOutcome> {
  const finished = Promise.withResolvers<ExecOutcome>();
  const child = execFile(
    file,
    args,
    {
      cwd: options.cwd,
      env: hardenedGitEnvironment(),
      timeout: options.timeout.total('milliseconds'),
      killSignal: 'SIGTERM',
      maxBuffer: options.maxBufferBytes,
      encoding: 'buffer',
      windowsHide: true,
      shell: false,
      ...(options.signal !== undefined && { signal: options.signal }),
    },
    (error, stdout, stderr): void => {
      finished.resolve({ error, stdout, stderr: stderr.toString('utf8') });
    },
  );
  // On an abort, execFile answers as soon as it has sent the signal; git may still be removing
  // its lock files. A child that never started (no pid) has nothing to wait for.
  let exited = Promise.resolve();
  if (child.pid !== undefined) {
    exited = new Promise<void>((resolve) => {
      child.once('exit', () => {
        resolve();
      });
    });
  }
  child.stdin?.on('error', ignoreBrokenPipe);
  child.stdin?.end(options.input);
  const [outcome] = await Promise.all([finished.promise, exited]);
  return outcome;
}

/** git may exit (e.g. on a bad argument) before reading its input; the exit code says why. */
function ignoreBrokenPipe(): void {
  // The failure is reported through the exit status instead.
}

const notARepositoryPattern = /not a git repository/iu;
const dubiousOwnershipPattern = /dubious ownership/iu;

async function classifyFailure(
  outcome: ExecOutcome,
  request: Required<Pick<GitRequest, 'cwd' | 'args' | 'gitBinary' | 'timeout' | 'maxBufferBytes'>>,
): Promise<GitError> {
  const { error, stdout, stderr } = outcome;
  const { args } = request;
  const code = error?.code;
  if (code === 'ENOENT') {
    if (await isDirectory(request.cwd)) {
      return { kind: 'git-not-found', gitBinary: request.gitBinary };
    }
    return { kind: 'not-a-repository', path: request.cwd, stderr: 'directory does not exist' };
  }
  if (code === 'ABORT_ERR') {
    return { kind: 'aborted', args };
  }
  if (code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return { kind: 'output-too-large', args, maxBufferBytes: request.maxBufferBytes };
  }
  if (error?.killed === true) {
    return { kind: 'timeout', args, timeout: request.timeout };
  }
  if (notARepositoryPattern.test(stderr)) {
    return { kind: 'not-a-repository', path: request.cwd, stderr: stderr.trim() };
  }
  if (dubiousOwnershipPattern.test(stderr)) {
    return { kind: 'unsafe-repository', path: request.cwd, stderr: stderr.trim() };
  }
  return {
    kind: 'command-failed',
    args,
    exitCode: exitCodeOf(code),
    signal: error?.signal ?? undefined,
    stdout: stdout.toString('utf8'),
    stderr: stderr.trim(),
  };
}

async function isDirectory(directory: string): Promise<boolean> {
  try {
    const stats = await stat(directory);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/** What the debug log records: 0 for success, else execFile's `code`. */
function loggedExitCode(error: ExecFileException | null): ExecFileException['code'] {
  if (error === null) {
    return 0;
  }
  return error.code;
}

/** execFile's `code` is the exit code for a process that ran, and a string for one that didn't. */
function exitCodeOf(code: ExecFileException['code']): number | undefined {
  if (typeof code === 'number') {
    return code;
  }
  return undefined;
}
