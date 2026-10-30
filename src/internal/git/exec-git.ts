import { execFile } from 'node:child_process';
import type { ExecFileException } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import type { Logger } from '#x/log/create-logger.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';
import { Stopwatch } from '#x/time/stopwatch.ts';

import type { GitError } from './git-error.ts';

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
  readonly logger?: Logger;
}

const defaultTimeout = Temporal.Duration.from({ seconds: 30 });
const defaultMaxBufferBytes = 64 * 1024 * 1024;

/**
 * Global options that make git's output predictable and keep repository-controlled config from
 * running programs: no pager, literal pathspecs, unquoted UTF-8 paths, no colour, no fsmonitor
 * or hooks, and standard `a/` `b/` diff prefixes.
 */
const hardeningArgs = [
  '--no-pager',
  '--literal-pathspecs',
  '-c',
  'core.quotepath=off',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'color.ui=false',
  '-c',
  'diff.noprefix=false',
  '-c',
  'diff.mnemonicPrefix=false',
  '-c',
  'diff.relative=false',
];

/**
 * Runs git directly (never through a shell) and returns its raw stdout. Inherited `GIT_*`
 * variables are dropped so the caller's environment can't redirect git to another repository,
 * prompts and pagers are disabled, and messages are forced to the C locale so failures can be
 * classified. Never rejects.
 */
export async function execGit(request: GitRequest): Promise<Result<Buffer, GitError>> {
  const invalid = validateRequest(request);
  if (invalid !== undefined) {
    return err(invalid);
  }
  const gitBinary = request.gitBinary ?? 'git';
  const timeout = request.timeout ?? defaultTimeout;
  const maxBufferBytes = request.maxBufferBytes ?? defaultMaxBufferBytes;
  const stopwatch = new Stopwatch();
  const outcome = await execute(gitBinary, [...hardeningArgs, ...request.args], {
    cwd: request.cwd,
    timeout,
    maxBufferBytes,
    input: request.input,
  });
  request.logger?.debug('git', {
    args: request.args,
    cwd: request.cwd,
    duration: stopwatch.elapsed(),
    exitCode: outcome.error === null ? 0 : outcome.error.code,
  });
  return outcome.error === null
    ? ok(outcome.stdout)
    : err(
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
  return withNul === undefined
    ? undefined
    : { kind: 'invalid-argument', argument: withNul, reason: 'contains a NUL byte' };
}

interface ExecOutcome {
  readonly error: ExecFileException | null;
  readonly stdout: Buffer;
  readonly stderr: string;
}

async function execute(
  file: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly timeout: Temporal.Duration;
    readonly maxBufferBytes: number;
    readonly input: string | undefined;
  },
): Promise<ExecOutcome> {
  return new Promise((resolve) => {
    const child = execFile(
      file,
      args,
      {
        cwd: options.cwd,
        env: hardenedEnvironment(),
        timeout: options.timeout.total('milliseconds'),
        maxBuffer: options.maxBufferBytes,
        encoding: 'buffer',
        windowsHide: true,
        shell: false,
      },
      (error, stdout, stderr): void => {
        resolve({ error, stdout, stderr: stderr.toString('utf8') });
      },
    );
    child.stdin?.on('error', ignoreBrokenPipe);
    child.stdin?.end(options.input);
  });
}

function hardenedEnvironment(): NodeJS.ProcessEnv {
  const inherited = Object.entries(process.env).filter(
    ([key]) => !key.toUpperCase().startsWith('GIT_'),
  );
  return {
    ...Object.fromEntries(inherited),
    GIT_TERMINAL_PROMPT: '0',
    GIT_PAGER: 'cat',
    PAGER: 'cat',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_NO_REPLACE_OBJECTS: '1',
    LC_ALL: 'C',
    LANGUAGE: 'C',
  };
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
    return (await isDirectory(request.cwd))
      ? { kind: 'git-not-found', gitBinary: request.gitBinary }
      : { kind: 'not-a-repository', path: request.cwd, stderr: 'directory does not exist' };
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
    exitCode: typeof code === 'number' ? code : undefined,
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
