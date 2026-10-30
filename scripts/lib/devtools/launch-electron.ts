import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { errorFrom } from '../../../src/x/error/error-from.ts';

/** The launched app: its DevTools browser URL, and its output so far. Disposing it kills it. */
export interface LaunchedElectron extends AsyncDisposable {
  readonly browserUrl: string;
  readonly output: () => string;
}

export interface LaunchElectronOptions {
  /** The checkout whose `node_modules/.bin/electron` runs it, with `dist/` built. */
  readonly root: string;
  /** A fresh directory: the app's `userData` (database, worktrees) and Chromium's profile. */
  readonly userDataDir: string;
  /** More Electron or Chromium switches, before the app path. */
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}

/** How often the launcher looks for Chromium's `DevToolsActivePort`, in milliseconds. */
const pollMilliseconds = 100;

/**
 * Starts the built app with remote debugging on a port Chromium picks, and waits for the port it
 * writes to `<userDataDir>/DevToolsActivePort`. Rejects with the app's output when `signal` aborts
 * or the app exits first.
 */
export async function launchElectron(options: LaunchElectronOptions): Promise<LaunchedElectron> {
  // The `electron` package's main module is the binary's path; its `.bin` wrapper would outlive a kill.
  const electron = createRequire(path.join(options.root, 'package.json'))('electron') as string;
  // eslint-disable-next-line local/forward-abort-signal -- `signal` bounds the start only; the app outlives it until disposed.
  const child = spawn(
    electron,
    [
      '--remote-debugging-port=0',
      `--user-data-dir=${options.userDataDir}`,
      ...options.args,
      options.root,
    ],
    // Its own process group, so disposing kills the renderers and helpers too.
    { env: { ...process.env, ...options.env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
  );
  let output = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    output += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    output += chunk;
  });
  const exited = new Promise<undefined>((resolve) => {
    child.once('exit', () => {
      resolve(undefined);
    });
  });
  const launched: LaunchedElectron = {
    browserUrl: '',
    output: () => output,
    [Symbol.asyncDispose]: async (): Promise<void> => {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }
      process.kill(-(child.pid ?? 0), 'SIGKILL');
      await exited;
    },
  };
  try {
    const browserUrl = await Promise.race([waitForBrowserUrl(options), exited]);
    if (browserUrl === undefined) {
      throw new Error('it exited');
    }
    return { ...launched, browserUrl };
  } catch (error) {
    await launched[Symbol.asyncDispose]();
    throw new Error(`electron did not start: ${errorFrom(error).message}\n${output}`, {
      cause: error,
    });
  }
}

/** `ws://127.0.0.1:<port><path>` from Chromium's `DevToolsActivePort` file, once it exists. */
async function waitForBrowserUrl(options: LaunchElectronOptions): Promise<string> {
  const file = path.join(options.userDataDir, 'DevToolsActivePort');
  for (;;) {
    const contents = await contentsOrEmpty(file, options.signal);
    const [port, browserPath] = contents.split('\n', 2);
    if (port !== undefined && browserPath !== undefined && browserPath.length > 0) {
      return `ws://127.0.0.1:${port}${browserPath}`;
    }
    await delay(pollMilliseconds, undefined, { signal: options.signal });
  }
}

/** The file's text, or nothing while Chromium has not written it. */
async function contentsOrEmpty(file: string, signal: AbortSignal): Promise<string> {
  try {
    return await readFile(file, { encoding: 'utf8', signal });
  } catch (error) {
    signal.throwIfAborted();
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}
