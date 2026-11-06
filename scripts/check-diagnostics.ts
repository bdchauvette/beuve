import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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

/** The main window, as the steps address it. */
interface MainWindow {
  readonly devtools: DevtoolsConnection;
  readonly page: SessionId;
}

const root = path.resolve(import.meta.dirname, '..');
const runFile = promisify(execFile);
const waitSeconds = 60;
const app = "document.querySelector('beuve-app')";
const review = `${app}.renderRoot.querySelector('beuve-review')`;
const stream = `${review}.renderRoot.querySelector('beuve-diff-stream')`;
/** The file card of `src/a.ts`, whose head has a type error. */
const card = `[...${stream}.renderRoot.querySelectorAll('beuve-file-card')].find((card) => card.file?.path === 'src/a.ts')`;
const errorRanges = "CSS.highlights.get('beuve-diagnostic-error')";
const hoverCard = `${review}.renderRoot.querySelector('beuve-hover-card')`;

await checkDiagnostics();

/**
 * Drives language-server diagnostics (ADR 0111) in the built app, with the production Content
 * Security Policy and Trusted Types: opens a review of a generated TypeScript repository whose head
 * has one type error and one clean changed file, and checks that the card of the broken file counts
 * the error in its header, underlines exactly the text the server named, shows the message in the
 * hover card when the pointer rests on it, and that the clean file's card says nothing. Restart
 * Language Servers must bring the diagnostics back. The page must report no violation, uncaught
 * exception or console error.
 *
 * Build first (`node scripts/build.ts`). On Linux run it under a display, for example
 * `xvfb-run -a -s '-screen 0 1600x1000x24' node scripts/check-diagnostics.ts`; on macOS run it
 * directly. Switches after `--` go to Electron (`-- --no-sandbox` only where the sandbox cannot
 * start, such as as root). `--screenshots <dir>` saves a PNG at the end.
 */
async function checkDiagnostics(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: { screenshots: { type: 'string' } },
    allowPositionals: true,
  });
  const findings: Findings = { failures: [], reported: [] };
  const temporaryRoot = await realpath(os.tmpdir());
  const temporary = await mkdtemp(path.join(temporaryRoot, 'beuve-diagnostics-'));
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
    env: { BEUVE_LOG_LEVEL: 'warn' },
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
  console.log('diagnostics: open a review of a head with a type error');
  await devtools.evaluate(page, `${app}.session.open(${JSON.stringify(request)})`);
  await until(main, { expression: `${app}.review !== undefined`, what: 'the review to open' });

  console.log('diagnostics: the broken file’s card counts the error in its header');
  await until(main, {
    expression: `${card}?.diagnostics?.kind === 'ready'`,
    what: 'the language server to report on src/a.ts',
  });
  await expectValue(main, `${card}.diagnostics.view.state`, 'settled');
  await expectValue(main, `${card}.diagnostics.view.diagnostics.length`, 1);
  await expectValue(main, `${card}.diagnostics.view.diagnostics[0].code`, '2322');
  await until(main, {
    expression: `${card}.renderRoot.querySelector('.diagnostics-note')?.textContent.trim() === '1 error'`,
    what: 'the header to say "1 error"',
  });

  console.log('diagnostics: the underline covers exactly the text the server named');
  await until(main, {
    expression: `${errorRanges}?.size === 1`,
    what: 'one error underline on the screen',
  });
  await expectValue(main, `[...${errorRanges}][0].toString()`, 'answer');

  console.log('diagnostics: the clean file’s card says nothing');
  await until(main, {
    expression: `[...${stream}.renderRoot.querySelectorAll('beuve-file-card')].find((card) => card.file?.path === 'src/b.ts')?.diagnostics?.kind === 'ready'`,
    what: 'the language server to report on src/b.ts',
  });
  await expectValue(
    main,
    `[...${stream}.renderRoot.querySelectorAll('beuve-file-card')].find((card) => card.file?.path === 'src/b.ts').renderRoot.querySelector('.diagnostics-note') === null`,
    true,
  );

  console.log('diagnostics: the pointer resting on the underlined text shows the message');
  const center = (await devtools.evaluate(
    page,
    `(() => { const r = [...${errorRanges}][0].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
  )) as { readonly x: number; readonly y: number };
  await devtools.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...center }, page);
  await until(main, {
    expression: `${hoverCard}?.shown?.diagnostics?.length === 1`,
    what: 'the hover card to show the diagnostic',
  });
  await until(main, {
    expression: `${hoverCard}.renderRoot.querySelector('.card .diagnostic.error')?.textContent.includes('not assignable')`,
    what: 'the card to show the server’s message',
  });

  console.log('diagnostics: Restart Language Servers brings them back');
  await devtools.evaluate(page, `${app}.runCommandId('restart-language-servers')`);
  await until(main, {
    expression: `${app}.statusNotice?.text?.includes('restarted')`,
    what: 'the restart notice',
  });
  await until(main, {
    expression: `${card}?.diagnostics?.kind === 'ready' && ${errorRanges}?.size === 1`,
    what: 'the diagnostics to come back after the restart',
  });
}

/** Waits until `expression` holds in the page, or fails saying what it was waiting for. */
async function until(main: MainWindow, wanted: Wanted): Promise<void> {
  try {
    await main.devtools.waitFor(main.page, wanted.expression, wait());
  } catch {
    const state = JSON.stringify(
      await main.devtools.evaluate(
        main.page,
        `({ diagnostics: ${card}?.diagnostics ?? null, errorUnderlines: ${errorRanges}?.size ?? 0 })`,
      ),
    );
    throw new Error(`timed out waiting for ${wanted.what}; the card has: ${tailOf(state, 400)}`);
  }
}

/** A condition the page must reach, and what to say if it does not. */
interface Wanted {
  readonly expression: string;
  readonly what: string;
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
  await writeFile(path.join(directory, 'diagnostics.png'), Uint8Array.fromBase64(data));
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
      'diagnostics: the type error was counted, underlined and explained with no violation, exception or console error',
    );
    return;
  }
  for (const failure of failures) {
    console.error(`FAIL ${failure}`);
  }
  console.error(`the app's output:\n${tailOf(output, 2000)}`);
  process.exitCode = 1;
}

/**
 * A TypeScript project with `main` and a `feature` branch that breaks `src/a.ts` with a type error
 * and changes `src/b.ts` cleanly, for the review.
 */
async function createRepository(directory: string): Promise<void> {
  await mkdir(path.join(directory, 'src'), { recursive: true });
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
  await writeFile(
    path.join(directory, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        target: 'es2022',
        module: 'esnext',
        noEmit: true,
        types: [],
      },
      include: ['src'],
    }),
  );
  await writeFile(path.join(directory, 'src/a.ts'), 'export const answer: number = 42;\n');
  await writeFile(path.join(directory, 'src/b.ts'), 'export const b = 1;\n');
  await git('add', '--all');
  await git('commit', '--quiet', '--message', 'base');
  await git('switch', '--quiet', '--create', 'feature');
  await writeFile(path.join(directory, 'src/a.ts'), "export const answer: number = 'forty-two';\n");
  await writeFile(path.join(directory, 'src/b.ts'), 'export const b = 2;\n');
  await git('commit', '--quiet', '--all', '--message', 'feature');
}

/** A fresh deadline for one wait. */
function wait(): AbortSignal {
  return timeoutSignal(Temporal.Duration.from({ seconds: waitSeconds }));
}
