import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs, promisify } from 'node:util';

import { errorFrom } from '../src/x/error/error-from.ts';
import { removeTree } from '../src/x/fs/remove-tree.ts';
import { tailOf } from '../src/x/text/tail-of.ts';
import { timeoutSignal } from '../src/x/time/timeout-signal.ts';

import { DevtoolsConnection } from './lib/devtools/devtools-connection.ts';
import type { DevtoolsEvent, SessionId } from './lib/devtools/devtools-connection.ts';
import { launchElectron } from './lib/devtools/launch-electron.ts';

/** What the run found. Any failure fails the check. */
interface Findings {
  readonly failures: string[];
  /** Content Security Policy and Trusted Types violations, and uncaught errors, the page reported. */
  readonly reported: string[];
}

/** A condition the page must reach, and what to say if it does not. */
interface Wanted {
  readonly expression: string;
  readonly what: string;
}

/** The main window, as the steps address it. */
interface MainWindow {
  readonly devtools: DevtoolsConnection;
  readonly page: SessionId;
}

const root = path.resolve(import.meta.dirname, '..');
const runFile = promisify(execFile);
const waitSeconds = 30;
const app = "document.querySelector('beuve-app')";
const panel = `${app}.renderRoot.querySelector('beuve-review').renderRoot.querySelector('beuve-terminal-panel')`;
/** The screen text of the visible terminal (xterm's DOM renderer writes its rows as text). */
const screenText = `(${panel}?.renderRoot.querySelector('.host:not([hidden]) .xterm-rows')?.textContent ?? '')`;

await checkTerminal();

/**
 * Drives the terminal panel (ADR 0095) in the built app, with the production Content Security
 * Policy and Trusted Types: opens a review of a generated repository, shows the panel, types
 * commands into the shell through the page's keyboard, and checks that the shell runs in beuve's
 * checkout and not in the clone, that output returns to the screen, that hiding and showing the
 * panel replays the running shell instead of starting another, that Restart Language Servers
 * answers, and that a shell that exits is marked ended. The page must report no violation, uncaught
 * exception or console error.
 *
 * Build first (`node scripts/build.ts`). On Linux run it under a display, for example
 * `xvfb-run -a -s '-screen 0 1600x1000x24' node scripts/check-terminal.ts`; on macOS run it
 * directly. Switches after `--` go to Electron (`-- --no-sandbox` only where the sandbox cannot
 * start, such as as root). `--screenshots <dir>` saves a PNG at the end.
 */
async function checkTerminal(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: { screenshots: { type: 'string' } },
    allowPositionals: true,
  });
  const findings: Findings = { failures: [], reported: [] };
  const temporaryRoot = await realpath(os.tmpdir());
  const temporary = await mkdtemp(path.join(temporaryRoot, 'beuve-terminal-'));
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(async (): Promise<void> => {
    await removeTree(temporary);
  });
  const repository = path.join(temporary, 'repo');
  await createRepository(repository);
  await using launched = await launchElectron({
    root,
    userDataDir: path.join(temporary, 'user-data'),
    args: positionals,
    // A plain POSIX shell, so the user's own shell and its start-up files do not decide the run.
    env: { BEUVE_LOG_LEVEL: 'warn', BEUVE_MCP_PORT: String(await freePort()), SHELL: '/bin/sh' },
    signal: wait(),
  });
  using devtools = await DevtoolsConnection.open(launched.browserUrl, async (page, connection) => {
    connection.post('Runtime.enable', {}, page.sessionId);
    connection.post('Page.enable', {}, page.sessionId);
    await Promise.resolve();
  });
  devtools.on((event) => {
    recordEvent(event, findings);
  });
  const page = await devtools.waitForPage((url) => {
    return url.endsWith('/index.html');
  }, wait());
  const main: MainWindow = { devtools, page };
  try {
    await devtools.waitFor(page, `!!${app}?.renderRoot`, wait());
    await devtools.send('Emulation.setFocusEmulationEnabled', { enabled: true }, page);
    await devtools.evaluate(
      page,
      `window.__violations = []; document.addEventListener('securitypolicyviolation', (event) => window.__violations.push(event.effectiveDirective + ' ' + event.blockedURI + ' ' + event.sample), true);`,
    );
    await runSteps(main, repository);
    const violations = (await devtools.evaluate(page, 'window.__violations')) as string[];
    findings.reported.push(...violations);
    if (values.screenshots !== undefined) {
      await shoot(main, path.resolve(values.screenshots));
    }
  } catch (error) {
    findings.failures.push(
      `the run stopped: ${errorFrom(error).stack ?? errorFrom(error).message}`,
    );
  }
  report(findings, launched.output());
}

async function runSteps(main: MainWindow, repository: string): Promise<void> {
  const { devtools, page } = main;
  const request = { repoPath: repository, baseRef: 'main', headRef: 'feature' };
  console.log('terminal: open a review and show the panel');
  await devtools.evaluate(page, `${app}.session.open(${JSON.stringify(request)})`);
  await until(main, { expression: `${app}.review !== undefined`, what: 'the review to open' });
  const headSha = String(await devtools.evaluate(page, `${app}.review.headSha`));
  await devtools.evaluate(page, `${app}.runCommandId('toggle-terminal')`);
  await until(main, {
    expression: `!!${panel}?.renderRoot.querySelector('.xterm')`,
    what: 'the terminal to mount',
  });

  console.log('terminal: a typed command runs and its output returns to the screen');
  await type(main, 'echo ran-$((6*7))-$BEUVE_HEAD_SHA');
  const output = `${screenText}.includes(${JSON.stringify(`ran-42-${headSha}`)})`;
  await until(main, { expression: output, what: 'the typed command’s output on the screen' });

  console.log('terminal: the shell is in beuve’s checkout, not the clone');
  await type(
    main,
    '[ "$(pwd -P)" = "$(cd "$BEUVE_CHECKOUT" && pwd -P)" ] && [ "$BEUVE_CHECKOUT" != "$BEUVE_REPOSITORY" ] && echo checked-$((20+2))',
  );
  await until(main, {
    expression: `${screenText}.includes('checked-22')`,
    what: 'the shell to report it is in the checkout',
  });

  console.log('terminal: hiding and showing the panel replays the shell, it starts no other');
  await devtools.evaluate(page, `${app}.runCommandId('toggle-terminal')`);
  await until(main, { expression: `!${panel}`, what: 'the panel to hide' });
  await devtools.evaluate(page, `${app}.runCommandId('toggle-terminal')`);
  await until(main, {
    expression: output,
    what: 'the replayed output after the panel showed again',
  });
  await expectValue(main, `${panel}.tabs.length`, 1);

  console.log('terminal: a second tab opens and closes');
  await devtools.evaluate(page, `${panel}.renderRoot.querySelector('[data-action="new"]').click()`);
  await until(main, { expression: `${panel}.tabs.length === 2`, what: 'a second tab' });
  await devtools.evaluate(
    page,
    `${panel}.renderRoot.querySelector('[data-action="close"][data-terminal-id="' + ${panel}.activeId + '"]').click()`,
  );
  await until(main, { expression: `${panel}.tabs.length === 1`, what: 'the tab to close' });

  console.log('terminal: Restart Language Servers answers');
  await devtools.evaluate(page, `${app}.runCommandId('restart-language-servers')`);
  await until(main, {
    expression: `${app}.statusNotice?.text?.includes('restarted')`,
    what: 'the restart notice',
  });

  console.log('terminal: a shell that exits is marked ended');
  await devtools.evaluate(page, `${panel}.select(${panel}.tabs[0].id)`);
  await type(main, 'exit');
  await until(main, {
    expression: `${panel}.tabs[0].isRunning === false`,
    what: 'the tab to be marked ended',
  });
  await until(main, {
    expression: `${screenText}.includes('shell exited')`,
    what: 'the exit notice on the screen',
  });
}

/** Waits until `expression` holds in the page, or fails saying what it was waiting for. */
async function until(main: MainWindow, wanted: Wanted): Promise<void> {
  try {
    await main.devtools.waitFor(main.page, wanted.expression, wait());
  } catch {
    const screen = String(await main.devtools.evaluate(main.page, screenText));
    throw new Error(
      `timed out waiting for ${wanted.what}; the terminal shows: ${tailOf(screen, 300)}`,
    );
  }
}

/** Types `text` and Enter into the focused terminal, through the page's keyboard. */
async function type(main: MainWindow, text: string): Promise<void> {
  const { devtools, page } = main;
  await devtools.send('Input.insertText', { text }, page);
  const enter = {
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  };
  await devtools.send('Input.dispatchKeyEvent', { type: 'keyDown', text: '\r', ...enter }, page);
  await devtools.send('Input.dispatchKeyEvent', { type: 'keyUp', ...enter }, page);
  await delay(50);
}

async function expectValue(main: MainWindow, expression: string, expected: unknown): Promise<void> {
  const actual = await main.devtools.evaluate(main.page, expression);
  if (actual !== expected) {
    throw new Error(`${expression} is ${JSON.stringify(actual)}, not ${JSON.stringify(expected)}`);
  }
}

async function shoot(main: MainWindow, directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  const { data } = (await main.devtools.send(
    'Page.captureScreenshot',
    { format: 'png' },
    main.page,
  )) as { readonly data: string };
  await writeFile(path.join(directory, 'terminal.png'), Uint8Array.fromBase64(data));
}

function recordEvent(event: DevtoolsEvent, findings: Findings): void {
  if (event.method === 'Runtime.exceptionThrown') {
    const details = event.params['exceptionDetails'] as {
      readonly text?: string;
      readonly exception?: { readonly description?: string };
    };
    findings.reported.push(
      `uncaught exception: ${(details.exception?.description ?? details.text ?? '').slice(0, 400)}`,
    );
  } else if (event.method === 'Runtime.consoleAPICalled' && event.params['type'] === 'error') {
    const args = event.params['args'] as readonly { readonly description?: string }[];
    findings.reported.push(
      `console error: ${args
        .map((arg) => arg.description ?? '')
        .join(' ')
        .slice(0, 400)}`,
    );
  }
}

function report(findings: Findings, output: string): void {
  const failures = [...findings.failures, ...findings.reported];
  if (failures.length === 0) {
    console.log(
      'terminal: the panel ran a real shell with no violation, exception or console error',
    );
    return;
  }
  for (const failure of failures) {
    console.error(`FAIL ${failure}`);
  }
  console.error(`the app's output:\n${tailOf(output, 2000)}`);
  process.exitCode = 1;
}

/** A repository with `main` and a `feature` branch that changes one file, for the review. */
async function createRepository(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  const git = async (...args: string[]): Promise<void> => {
    await runFile('git', args, {
      cwd: directory,
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_AUTHOR_NAME: 'Fixture',
        GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
        GIT_COMMITTER_NAME: 'Fixture',
        GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
      },
    });
  };
  await git('init', '--quiet', '--initial-branch=main');
  await writeFile(path.join(directory, 'a.ts'), 'export const a = 1;\n');
  await git('add', '--all');
  await git('commit', '--quiet', '--message', 'base');
  await git('switch', '--quiet', '--create', 'feature');
  await writeFile(path.join(directory, 'a.ts'), 'export const a = 2;\n');
  await git('commit', '--quiet', '--all', '--message', 'feature');
}

/** A TCP port nothing listens on now, for the app's MCP server. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  if (typeof address === 'object' && address !== null) {
    return address.port;
  }
  return 0;
}

/** A fresh deadline for one wait. */
function wait(): AbortSignal {
  return timeoutSignal(Temporal.Duration.from({ seconds: waitSeconds }));
}
