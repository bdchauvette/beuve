import { spawn } from 'node:child_process';
import path from 'node:path';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';
import { tailOf } from '#x/text/tail-of.ts';
import { timeoutSignal } from '#x/time/timeout-signal.ts';

import { parseShellEnvironment } from './parse-shell-environment.ts';
import type { ShellEnvironmentError } from './shell-environment-error.ts';

/** What to run, and where. */
export interface ReadShellEnvironmentOptions {
  /** The reviewer's shell, such as `/bin/zsh`. */
  readonly shell: string;
  /** Absolute path of a `node`, which reads the environment back as JSON (ADR 0083). */
  readonly nodeCommand: string;
  /** The directory the shell starts in: the home directory, or a checkout. */
  readonly cwd: string;
  /** The environment the shell starts in; beuve's own, which this strips of what must not reach it. */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly timeout: Temporal.Duration;
  readonly signal?: AbortSignal;
}

/** Reads the environment the reviewer's login shell gives in a directory. */
export type ReadShellEnvironment = (
  options: ReadShellEnvironmentOptions,
) => Promise<Result<Record<string, string>, ShellEnvironmentError>>;

const maxOutputBytes = 1024 * 1024;
const stderrTailChars = 2048;
/** Set while resolving, so start-up files can tell (as VS Code's `VSCODE_RESOLVING_ENVIRONMENT`). */
const resolvingVariable = 'BEUVE_RESOLVING_ENVIRONMENT';

/**
 * Runs the reviewer's shell as an interactive login shell, as VS Code does (`-i -l -c`; `-ic` for
 * csh and tcsh), so the files that set `PATH` for a terminal run, and has it print its environment
 * as JSON between random markers through `nodeCommand`: whatever the start-up files print around
 * it is ignored. No terminal is attached, stdin is closed, the deadline kills the shell, and the
 * environment it starts in has no `ELECTRON_*`, `CHROME_*` or `NODE_OPTIONS`.
 */
export async function readShellEnvironment(
  options: ReadShellEnvironmentOptions,
): Promise<Result<Record<string, string>, ShellEnvironmentError>> {
  const marker = crypto.randomUUID().replaceAll('-', '');
  const command = `${quoted(options.nodeCommand)} -p ${quoted(`"${marker}" + JSON.stringify(process.env) + "${marker}"`)}`;
  const deadline = timeoutSignal(options.timeout);
  let signal = deadline;
  if (options.signal !== undefined) {
    signal = AbortSignal.any([options.signal, deadline]);
  }
  const child = spawn(options.shell, [...shellFlagsFor(options.shell), command], {
    cwd: options.cwd,
    env: spawnEnvironmentFrom(options.env),
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    windowsHide: true,
    signal,
    killSignal: 'SIGKILL',
  });
  let stdout = '';
  let outputBytes = 0;
  let isTooLarge = false;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    outputBytes += Buffer.byteLength(chunk);
    if (outputBytes > maxOutputBytes) {
      isTooLarge = true;
      child.kill('SIGKILL');
      return;
    }
    stdout += chunk;
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr = tailOf(stderr + chunk, stderrTailChars);
  });

  return await new Promise((resolve) => {
    child.once('error', (error: NodeJS.ErrnoException) => {
      resolve(err(failureFrom({ error, signal, deadline, timeout: options.timeout })));
    });
    child.once('close', (code) => {
      if (isTooLarge) {
        resolve(err({ kind: 'unreadable', reason: 'the shell printed too much' }));
      } else if (code === 0) {
        resolve(withoutResolvingVariable(parseShellEnvironment({ output: stdout, marker })));
      } else if (signal.aborted) {
        resolve(err(abortedFrom({ signal, deadline, timeout: options.timeout })));
      } else {
        resolve(err({ kind: 'failed', code, stderr }));
      }
    });
  });
}

function shellFlagsFor(shell: string): readonly string[] {
  const name = path.basename(shell);
  if (name === 'csh' || name === 'tcsh') {
    return ['-ic'];
  }
  return ['-i', '-l', '-c'];
}

/** Single quotes, which no POSIX shell expands inside. */
function quoted(text: string): string {
  return `'${text.replaceAll("'", String.raw`'\''`)}'`;
}

function spawnEnvironmentFrom(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const spawnEnv: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    const upper = name.toUpperCase();
    const isStripped =
      upper.startsWith('ELECTRON_') || upper.startsWith('CHROME_') || upper === 'NODE_OPTIONS';
    if (value !== undefined && !isStripped) {
      spawnEnv[name] = value;
    }
  }
  spawnEnv[resolvingVariable] = '1';
  return spawnEnv;
}

function withoutResolvingVariable(
  parsed: Result<Record<string, string>, ShellEnvironmentError>,
): Result<Record<string, string>, ShellEnvironmentError> {
  if (!parsed.ok) {
    return parsed;
  }
  const entries = Object.entries(parsed.value).filter(([name]) => name !== resolvingVariable);
  return ok(Object.fromEntries(entries));
}

/** How an abort ended the run: the deadline passing, or the caller cancelling. */
interface AbortContext {
  readonly signal: AbortSignal;
  readonly deadline: AbortSignal;
  readonly timeout: Temporal.Duration;
}

function abortedFrom({ signal, deadline, timeout }: AbortContext): ShellEnvironmentError {
  if (signal.reason === deadline.reason) {
    return { kind: 'timed-out', timeout };
  }
  return { kind: 'cancelled' };
}

interface SpawnFailure extends AbortContext {
  readonly error: NodeJS.ErrnoException;
}

function failureFrom({ error, ...abort }: SpawnFailure): ShellEnvironmentError {
  if (error.name === 'AbortError') {
    return abortedFrom(abort);
  }
  return { kind: 'not-started', reason: error.message };
}
