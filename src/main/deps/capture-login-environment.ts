import { spawn } from 'node:child_process';
import process from 'node:process';

import { anySignal } from '#x/async/any-signal.ts';
import { tailOf } from '#x/text/tail-of.ts';
import { timeoutSignal } from '#x/time/timeout-signal.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

/** The user's login shell, where to start it, and how long to give it. */
export interface LoginShellOptions {
  /** `$SHELL`; `/bin/zsh` on macOS, `/bin/sh` elsewhere, when unset. */
  readonly shell: string;
  /** `$HOME`: the shell starts there, never in a reviewed directory. */
  readonly home: string;
  /** Defaults to 10 s. */
  readonly timeout?: Temporal.Duration;
  readonly signal?: AbortSignal;
}

/** Variables kept from the capture: `PATH` and what version managers and tools read. */
const keptNames = new Set([
  'PATH',
  'VOLTA_HOME',
  'NVM_DIR',
  'PYENV_ROOT',
  'RBENV_ROOT',
  'GEM_HOME',
  'GEM_PATH',
  'COMPOSER_HOME',
  'GOPATH',
  'GOROOT',
  'CARGO_HOME',
  'RUSTUP_HOME',
  'JAVA_HOME',
]);
const keptPrefixes = ['MISE_', 'ASDF_', 'FNM_', 'UV_', 'RV_', 'BUN_', 'PNPM_'];
const marker = '__beuve_environment__';
const maxOutput = 1024 * 1024;
const assignment = /^(?<name>[A-Za-z_]\w*)=(?<value>.*)$/u;

/**
 * Runs the user's login shell once, interactive (`-i -l -c`), the way a terminal would, from
 * `$HOME` with stdin closed and a minimal environment, and reads the environment it ends up with
 * (ADR 0089). A Finder-launched app gets only `/usr/bin:/bin:/usr/sbin:/sbin`; this finds
 * Homebrew, mise, asdf, volta, fnm, rv and uv the way the user's terminal does. Starting in
 * `$HOME` keeps directory hooks (mise activate, direnv) from loading a reviewed repository's
 * configuration. Keeps `PATH` and version-manager variables only. Its own process group is
 * killed on timeout or abort.
 */
export async function captureLoginEnvironment(
  options: LoginShellOptions,
): Promise<Result<Readonly<Record<string, string>>, string>> {
  const deadline = timeoutSignal(options.timeout ?? Temporal.Duration.from({ seconds: 10 }));
  const signal = anySignal(deadline, options.signal) ?? deadline;
  const isOwnGroup = process.platform !== 'win32';
  // eslint-disable-next-line local/forward-abort-signal -- the abort listener kills the shell's whole process group, which rc files may have grown.
  const child = spawn(options.shell, ['-i', '-l', '-c', `printf '%s\\n' '${marker}'; env`], {
    cwd: options.home,
    env: {
      HOME: options.home,
      USER: process.env['USER'] ?? '',
      LOGNAME: process.env['LOGNAME'] ?? '',
      SHELL: options.shell,
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      TERM: 'dumb',
      LANG: process.env['LANG'] ?? 'en_US.UTF-8',
    },
    stdio: ['ignore', 'pipe', 'ignore'],
    detached: isOwnGroup,
    shell: false,
  });
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    output = tailOf(output + chunk, maxOutput);
  });
  using stack = new DisposableStack();
  const listeners = stack.adopt(new AbortController(), (controller) => {
    controller.abort();
  });
  signal.addEventListener(
    'abort',
    () => {
      try {
        if (isOwnGroup && child.pid !== undefined) {
          process.kill(-child.pid, 'SIGKILL');
        } else {
          child.kill('SIGKILL');
        }
      } catch {
        // Already gone.
      }
    },
    { once: true, signal: listeners.signal },
  );
  const exit = await new Promise<string | undefined>((resolve) => {
    child.once('error', (error) => {
      resolve(error.message);
    });
    child.once('close', () => {
      resolve(undefined);
    });
  });
  if (signal.aborted) {
    return err(`${options.shell} did not finish in time`);
  }
  if (exit !== undefined) {
    return err(exit);
  }
  return environmentAfter({ output, shell: options.shell });
}

/** What the shell printed, and which shell it was (for the error). */
interface ShellOutput {
  readonly output: string;
  readonly shell: string;
}

function environmentAfter({
  output,
  shell,
}: ShellOutput): Result<Readonly<Record<string, string>>, string> {
  const start = output.lastIndexOf(`${marker}\n`);
  if (start === -1) {
    return err(`${shell} printed no environment`);
  }
  const captured: Record<string, string> = {};
  const lines = output.slice(start + marker.length + 1).split('\n');
  for (const line of lines) {
    const match = assignment.exec(line);
    const name = match?.groups?.['name'];
    const value = match?.groups?.['value'];
    if (name === undefined || value === undefined) {
      continue;
    }
    if (keptNames.has(name) || keptPrefixes.some((prefix) => name.startsWith(prefix))) {
      captured[name] = value;
    }
  }
  return ok(captured);
}
