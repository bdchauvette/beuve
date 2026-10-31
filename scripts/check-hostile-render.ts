import { mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { extraMarkup } from '../src/ui/testing/extra-markup.ts';
import { hostileCorpus } from '../src/ui/testing/hostile-corpus.ts';
import { errorFrom } from '../src/x/error/error-from.ts';
import { removeTree } from '../src/x/fs/remove-tree.ts';
import { revealFormatControls } from '../src/x/text/reveal-format-controls.ts';
import { timeoutSignal } from '../src/x/time/timeout-signal.ts';

import { DevtoolsConnection } from './lib/devtools/devtools-connection.ts';
import type { DevtoolsEvent, DevtoolsPage, SessionId } from './lib/devtools/devtools-connection.ts';
import { launchElectron } from './lib/devtools/launch-electron.ts';
import { createHostileRepository } from './lib/hostile-render/create-hostile-repository.ts';
import type {
  HostileFile,
  HostileRepository,
} from './lib/hostile-render/create-hostile-repository.ts';
import { pageProbe } from './lib/hostile-render/page-probe.ts';

/** A Content Security Policy violation a page reported, from the listener installed before its scripts. */
interface Violation {
  readonly page: string;
  readonly directive: string;
  readonly blocked: string;
  readonly sample: string;
  readonly source: string;
}

/** What the run found. Any failure fails the check. */
interface Findings {
  readonly failures: string[];
  readonly violations: Violation[];
  readonly notes: string[];
}

/** What each step of the run works with. */
interface Run {
  readonly devtools: DevtoolsConnection;
  readonly findings: Findings;
  /** Saves a PNG of the page as `<name>.png` when `--screenshots` names a directory. */
  readonly shoot: (sessionId: SessionId, name: string) => Promise<void>;
}

/** Text a page shows, where it shows it, and what it must hold. */
interface TextCheck {
  readonly where: string;
  readonly text: string;
  readonly expected: readonly string[];
}

/** A value the page produced and the one it must equal, compared as JSON. */
interface Comparison {
  readonly actual: unknown;
  readonly expected: unknown;
}

/** One sanitizer case: what goes into the default policy and exactly what must come out. */
interface SanitizerCase {
  readonly label: string;
  readonly input: string;
  readonly output: string;
}

const root = path.resolve(import.meta.dirname, '..');
const violationMarker = '__beuve_violation__';
/** Installed in every page before its scripts run: reports violations through the console. */
const violationRecorder = String.raw`document.addEventListener('securitypolicyviolation', (event) => {
  console.debug('${violationMarker}' + JSON.stringify({
    page: location.pathname.split('/').pop(),
    directive: event.effectiveDirective,
    blocked: event.blockedURI,
    sample: event.sample,
    source: (event.sourceFile || '').replace(/^.*\/dist\//u, '') + ':' + event.lineNumber,
  }));
}, true);`;
const waitSeconds = 30;
const cspMeta = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/u;
/** What only the test build (`dist-test/`) may hold. */
const testBuildFile = /hostile-harness|pass-through-policy/u;
/** How often, and how many times at most, a card is serialized while its highlighting settles. */
const settlePollMilliseconds = 60;
const settlePolls = 100;
/**
 * ImpactGate's chip and its details, which the twin comparison leaves out: Lit builds them from
 * main's analysis of the code, so a hostile line that does not parse gets findings its benign
 * twin does not. The probe and the visibility checks still cover them.
 */
const impactSelector = '.impact-chip, .impact-popover';
/** Everything of a page URL up to the build output, which says nothing. */
const beforeDist = /^.*\/dist\//u;
/** Characters that reorder text: a displayed path must hold none of them (ADR 0082). */
// eslint-disable-next-line security/detect-unsafe-regex -- one character class and no quantifier: nothing to backtrack.
const bidiControls = /[\u{61C}\u{200E}\u{200F}\u{202A}-\u{202E}\u{2066}-\u{2069}]/u;

await checkHostileRender();

/**
 * Renders the shared hostile-input corpus (`src/ui/testing/hostile-corpus.ts`, ADR 0077) in the
 * built app. A generated repository holds it as far as a file system can, and the diff stream
 * (split and unified, each card against its benign twin's), peek, an inline sheet, a sheet window
 * and the Settings window must render it with no Content Security Policy violation, no uncaught
 * exception or console error, no element or attribute that runs script or loads from elsewhere,
 * and every hostile name and line visible as text. Then the test-only harness page renders every
 * corpus case through the components and the same oracle, and the Trusted Types default policy's
 * sanitizer, and that no second policy can be made, are checked in both pages.
 *
 * Build first (`node scripts/build.ts --hostile-harness`; add `--pass-through-policy` for the
 * negative control, which must fail). On Linux run it under a display, for example
 * `xvfb-run -a -s '-screen 0 1600x1000x24' node scripts/check-hostile-render.ts`; on macOS run it
 * directly. Switches after `--` go to Electron (`-- --no-sandbox` only where the sandbox cannot
 * start, such as as root). `--screenshots <dir>` saves a PNG of each step.
 */
async function checkHostileRender(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: { screenshots: { type: 'string' } },
    allowPositionals: true,
  });
  const findings: Findings = { failures: [], violations: [], notes: [] };
  const temporaryRoot = await realpath(os.tmpdir());
  const temporary = await mkdtemp(path.join(temporaryRoot, 'beuve-hostile-'));
  // beuve's checkouts under user-data are read-only (ADR 0033 amendment): `removeTree` reopens them.
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(async (): Promise<void> => {
    await removeTree(temporary);
  });
  const repository = await createHostileRepository(path.join(temporary, 'repo'), wait());
  findings.notes.push(
    `the repository holds the corpus but ${repository.skipped.join(', ')}, which only the harness renders`,
  );
  await using app = await launchElectron({
    root,
    userDataDir: path.join(temporary, 'user-data'),
    args: positionals,
    env: { BEUVE_LOG_LEVEL: 'warn', BEUVE_MCP_PORT: String(await freePort()) },
    signal: wait(),
  });
  using devtools = await DevtoolsConnection.open(app.browserUrl, preparePage);
  devtools.on((event) => {
    recordEvent(event, devtools, findings);
  });
  const shoot = async (sessionId: SessionId, name: string): Promise<void> => {
    if (values.screenshots === undefined) {
      return;
    }
    const screenshots = path.resolve(values.screenshots);
    await mkdir(screenshots, { recursive: true });
    const { data } = (await devtools.send(
      'Page.captureScreenshot',
      { format: 'png' },
      sessionId,
    )) as {
      readonly data: string;
    };
    await writeFile(path.join(screenshots, `${name}.png`), Uint8Array.fromBase64(data));
  };
  const run: Run = { devtools, findings, shoot };
  try {
    console.log('hostile render: the test build');
    await checkTestBuild(findings);
    console.log('hostile render: the main window');
    const main = await openMainWindow(devtools);
    console.log('hostile render: the diff stream, split and unified');
    await checkDiffStream(run, main, repository);
    console.log('hostile render: names with bidi and invisible characters');
    await checkPathDisplay(run, main, repository);
    console.log('hostile render: peek and an inline sheet');
    await checkPeekAndInlineSheet(run, main, repository);
    console.log('hostile render: a sheet window');
    await checkSheetWindow(run, main, repository);
    console.log('hostile render: the Settings window');
    await checkSettingsWindow(run, main);
    expectNone(
      findings,
      'Content Security Policy violation while rendering',
      findings.violations.map((violation) => JSON.stringify(violation)),
    );
    console.log('hostile render: the policy');
    await checkPolicy(devtools, main, findings);
    console.log('hostile render: the corpus through the components, in the harness page');
    const harness = await openHarness(devtools, main);
    await checkHarness(run, harness);
    console.log('hostile render: the harness page’s policy');
    await checkPolicy(devtools, harness, findings);
  } catch (error) {
    findings.failures.push(
      `the run stopped: ${errorFrom(error).stack ?? errorFrom(error).message}`,
    );
  }
  report(findings, app.output());
}

/** What `expression` evaluates to once it is truthy, or `undefined` if that takes too long. */
async function eventually(
  devtools: DevtoolsConnection,
  sessionId: SessionId,
  expression: string,
): Promise<unknown> {
  try {
    return await devtools.waitFor(sessionId, expression, wait());
  } catch {
    return undefined;
  }
}

/**
 * Sets where definitions open and waits until the app has applied it: the setting round-trips
 * through main, and a sheet action before it lands opens the other way.
 */
async function chooseSheets(
  devtools: DevtoolsConnection,
  main: SessionId,
  mode: 'inline' | 'window',
): Promise<void> {
  const app = "document.querySelector('beuve-app')";
  await devtools.evaluate(main, `${app}.runCommandId('sheets-${mode}')`);
  await devtools.waitFor(main, `${app}.display.sheets === '${mode}'`, wait());
}

/** A fresh deadline for one wait. */
function wait(): AbortSignal {
  return timeoutSignal(Temporal.Duration.from({ seconds: waitSeconds }));
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

/**
 * Turns on the domains the check reads and installs the violation recorder before the page's
 * scripts. Not awaited: a page held before its first script answers `Page.*` only once it runs,
 * and the browser applies a session's commands in the order they were sent.
 */
async function preparePage(page: DevtoolsPage, devtools: DevtoolsConnection): Promise<void> {
  devtools.post('Runtime.enable', {}, page.sessionId);
  devtools.post('Page.enable', {}, page.sessionId);
  devtools.post(
    'Page.addScriptToEvaluateOnNewDocument',
    { source: violationRecorder },
    page.sessionId,
  );
  await Promise.resolve();
}

function recordEvent(event: DevtoolsEvent, devtools: DevtoolsConnection, findings: Findings): void {
  const page = devtools.urlOf(event.sessionId).replace(beforeDist, '');
  if (event.method === 'Runtime.consoleAPICalled') {
    const args = event.params['args'] as readonly {
      readonly value?: unknown;
      readonly description?: string;
    }[];
    const text = args
      .map((arg) => {
        if (typeof arg.value === 'string') {
          return arg.value;
        }
        return arg.description ?? JSON.stringify(arg.value);
      })
      .join(' ');
    if (text.startsWith(violationMarker)) {
      findings.violations.push(JSON.parse(text.slice(violationMarker.length)) as Violation);
    } else if (event.params['type'] === 'error') {
      findings.failures.push(`unexpected console error in ${page}: ${text.slice(0, 300)}`);
    }
  } else if (event.method === 'Runtime.exceptionThrown') {
    const details = event.params['exceptionDetails'] as {
      readonly text?: string;
      readonly exception?: { readonly description?: string };
    };
    findings.failures.push(
      `uncaught exception in ${page}: ${(details.exception?.description ?? details.text ?? '').slice(0, 500)}`,
    );
  }
}

/** The main window, reloaded so the violation recorder runs before its scripts, with the probe installed. */
async function openMainWindow(devtools: DevtoolsConnection): Promise<SessionId> {
  const main = await devtools.waitForPage((url) => {
    return url.endsWith('/index.html');
  }, wait());
  const ready = "!!document.querySelector('beuve-app')?.renderRoot";
  await devtools.waitFor(main, ready, wait());
  await devtools.send('Page.reload', { ignoreCache: true }, main);
  await delay(500);
  await devtools.waitFor(main, ready, wait());
  await devtools.evaluate(main, pageProbe);
  return main;
}

/** Opens the review, then in split and unified views visits every card and checks what it shows. */
async function checkDiffStream(
  run: Run,
  main: SessionId,
  repository: HostileRepository,
): Promise<void> {
  const { devtools, findings, shoot } = run;
  const request = {
    repoPath: repository.directory,
    baseRef: repository.baseRef,
    headRef: repository.headRef,
  };
  await devtools.evaluate(
    main,
    `document.querySelector('beuve-app').openRepository(${JSON.stringify(request)})`,
  );
  const cardCount = repository.files.length + 1;
  await devtools.waitFor(
    main,
    `__hostileProbe.all('beuve-file-card').length >= ${String(cardCount)}`,
    wait(),
  );
  for (const view of ['split', 'inline'] as const) {
    await devtools.evaluate(
      main,
      `document.querySelector('beuve-app').runCommandId('diff-${view}')`,
    );
    const rendered = new Map<string, string>();
    for (const file of repository.files) {
      const card = `__hostileProbe.all('beuve-file-card').find((card) => card.file?.path === ${JSON.stringify(file.path)})`;
      const found = await devtools.evaluate(
        main,
        `(() => { const card = ${card}; if (!card) return false; card.collapsed = false; card.scrollIntoView(); return true; })()`,
      );
      if (found !== true) {
        findings.failures.push(`${view}: no card for ${JSON.stringify(file.path)}`);
        continue;
      }
      if (
        (await eventually(devtools, main, `__hostileProbe.rows(${card}.renderRoot) > 0`)) ===
        undefined
      ) {
        findings.failures.push(`${view}: ${JSON.stringify(file.path)} rendered no rows`);
      }
      const text = String(await devtools.evaluate(main, `__hostileProbe.text(${card}.renderRoot)`));
      expectVisible(findings, {
        where: `${view} card ${JSON.stringify(file.path)}`,
        text,
        expected: [...namesOf(file).map((name) => revealFormatControls(name)), ...file.lines],
      });
      rendered.set(file.path, await settledHtml(devtools, main, card));
    }
    for (const file of repository.files) {
      if (file.twin === undefined) {
        continue;
      }
      const twin = rendered.get(file.twin);
      if (twin === undefined) {
        continue;
      }
      expectNone(
        findings,
        `${view} card ${JSON.stringify(file.path)}: markup its twin ${JSON.stringify(file.twin)} lacks`,
        extraMarkup({ hostile: [rendered.get(file.path) ?? ''], benign: [twin] }),
      );
    }
    await expectSafe(run, main, `diff stream (${view})`);
    await devtools.evaluate(main, `(${cardOf(repository.contents.path)})?.scrollIntoView()`);
    await delay(300);
    await shoot(main, `stream-${view}-contents`);
    await devtools.evaluate(main, `__hostileProbe.all('beuve-file-card')[0]?.scrollIntoView()`);
    await delay(300);
    await shoot(main, `stream-${view}-names`);
  }
}

/** The file's path, and its path before a rename. */
function namesOf(file: HostileFile): readonly string[] {
  if (file.oldPath === undefined) {
    return [file.path];
  }
  return [file.path, file.oldPath];
}

/** A card serialized with its shadow roots once highlighting has finished: three equal polls in a row. */
async function settledHtml(
  devtools: DevtoolsConnection,
  main: SessionId,
  card: string,
): Promise<string> {
  let last = '';
  for (let polls = 0, stable = 0; polls < settlePolls && stable < 3; polls += 1) {
    await delay(settlePollMilliseconds);
    const html = String(
      await devtools.evaluate(
        main,
        `__hostileProbe.html(${card}, ${JSON.stringify(impactSelector)})`,
      ),
    );
    if (html === last) {
      stable += 1;
    } else {
      stable = 0;
    }
    last = html;
  }
  return last;
}

/**
 * Every card header, the file tree and a sheet's title show each name's bidi, control and
 * invisible characters as `⟨U+…⟩` escapes and hold no character that reorders text (ADR 0082).
 */
async function checkPathDisplay(
  run: Run,
  main: SessionId,
  repository: HostileRepository,
): Promise<void> {
  const { devtools, findings, shoot } = run;
  const app = "document.querySelector('beuve-app')";
  for (const file of repository.files) {
    const header = String(
      await devtools.evaluate(
        main,
        `(${cardOf(file.path)})?.renderRoot.querySelector('.header .path')?.textContent ?? ''`,
      ),
    );
    expectShown(findings, {
      where: `card header ${JSON.stringify(file.path)}`,
      text: header,
      expected: namesOf(file),
    });
  }
  const tree = "__hostileProbe.all('beuve-radar-tree')[0]";
  for (const name of repository.spoofing) {
    await devtools.evaluate(main, `${tree}?.revealPath(${JSON.stringify(name)})`);
    // The tree renders only the rows in view; revealing scrolls the row in once it has laid out.
    let names = '';
    for (let tries = 0; tries < 30 && !names.includes(revealFormatControls(name)); tries += 1) {
      await delay(100);
      names = String(await devtools.evaluate(main, treeNames(tree)));
    }
    const text = String(
      await devtools.evaluate(
        main,
        `__hostileProbe.text(${tree}?.renderRoot ?? document.createElement('i'))`,
      ),
    );
    expectShown(findings, {
      where: `file tree ${JSON.stringify(name)}`,
      text: `${names}\n${text}`,
      expected: [name],
    });
  }
  const [spoofing] = repository.spoofing;
  await devtools.evaluate(main, `(${cardOf(spoofing ?? '')})?.scrollIntoView()`);
  await delay(300);
  await shoot(main, 'names-tree-and-header');
  await chooseSheets(devtools, main, 'inline');
  await devtools.evaluate(
    main,
    `${app}.sheetAction({ kind: 'open', path: ${JSON.stringify(spoofing)}, range: { startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 1 } })`,
  );
  const sheet = "__hostileProbe.all('beuve-sheet-view')[0]";
  const title =
    (await eventually(
      devtools,
      main,
      `${sheet}?.renderRoot?.querySelector('header .title')?.textContent.includes('gpj')
        && ${sheet}.renderRoot.querySelector('header .title').textContent`,
    )) ?? '';
  expectShown(findings, { where: 'sheet title', text: textOf(title), expected: [spoofing ?? ''] });
  if (
    (await eventually(
      devtools,
      main,
      `${sheet} && __hostileProbe.rows(${sheet}.renderRoot) > 0`,
    )) === undefined
  ) {
    const shown = await devtools.evaluate(main, `__hostileProbe.text(${sheet}.renderRoot)`);
    findings.failures.push(
      `sheet of ${JSON.stringify(spoofing)} rendered no rows: ${String(shown)}`,
    );
  }
  await shoot(main, 'names-sheet');
}

/**
 * The names the tree's rows show, one per line. `@pierre/trees` splits a name at its extension
 * and renders each part twice (shown and overflow), so plain text would not hold it whole.
 */
function treeNames(tree: string): string {
  return `__hostileProbe.all('[data-item-section="content"]', ${tree}?.renderRoot ?? document.createElement('i'))
    .map((content) => [...content.querySelectorAll('[data-truncate-content="visible"]')].map((part) => part.textContent).join(''))
    .join(String.fromCharCode(10))`;
}

/** A string the page returned, or nothing. */
function textOf(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  return '';
}

/** `text` shows each of the `expected` names with its escapes, and nothing in it reorders text. */
function expectShown(findings: Findings, { where, text, expected }: TextCheck): void {
  expectVisible(findings, {
    where,
    text,
    expected: expected.map((name) => revealFormatControls(name)),
  });
  if (bidiControls.test(text)) {
    findings.failures.push(`${where}: shows a bidi control: ${JSON.stringify(text)}`);
  }
}

function cardOf(filePath: string): string {
  return `__hostileProbe.all('beuve-file-card').find((card) => card.file?.path === ${JSON.stringify(filePath)})`;
}

/** Peeks at the hostile lines, then opens an inline sheet of a hostile-named file. */
async function checkPeekAndInlineSheet(
  run: Run,
  main: SessionId,
  repository: HostileRepository,
): Promise<void> {
  const { devtools, findings, shoot } = run;
  const app = "document.querySelector('beuve-app')";
  const { peek } = repository;
  await devtools.evaluate(main, `(${cardOf(peek.path)})?.scrollIntoView()`);
  await devtools.evaluate(
    main,
    `${app}.openPeek(${JSON.stringify(peek.path)}, ${String(peek.line)})`,
  );
  const status =
    (await eventually(
      devtools,
      main,
      `['ready', 'error'].includes(${app}.peek?.status) && ${app}.peek.status`,
    )) ?? 'timed out';
  if (status !== 'ready') {
    const state = await devtools.evaluate(main, `JSON.stringify(${app}.peek)`);
    findings.failures.push(`peek: ${JSON.stringify(status)}: ${String(state)}`);
  }
  const portal = "__hostileProbe.all('beuve-peek-portal')[0]";
  if (
    (await eventually(
      devtools,
      main,
      `${portal}?.renderRoot?.textContent.includes('hostileCaller')`,
    )) === undefined
  ) {
    findings.failures.push('peek listed no caller');
  }
  const peekText = String(
    await devtools.evaluate(
      main,
      `__hostileProbe.text(${portal}?.renderRoot ?? document.createElement('i'))`,
    ),
  );
  expectVisible(findings, {
    where: 'peek',
    text: peekText,
    expected: ['hostileTarget', 'hostileCaller', peek.path],
  });
  await expectSafe(run, main, 'peek');
  await shoot(main, 'peek');
  await devtools.evaluate(main, `${app}.peek = undefined`);

  const named = repository.files.find((file) => file.path === repository.sheet);
  await chooseSheets(devtools, main, 'inline');
  await devtools.evaluate(
    main,
    `${app}.sheetAction({ kind: 'open', path: ${JSON.stringify(named?.path)}, range: { startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 1 } })`,
  );
  const sheet = "__hostileProbe.all('beuve-sheet-view')[0]";
  if (
    (await eventually(
      devtools,
      main,
      `${sheet} && __hostileProbe.rows(${sheet}.renderRoot) > 0`,
    )) === undefined
  ) {
    findings.failures.push('inline sheet rendered no rows');
  }
  const sheetText = String(
    await devtools.evaluate(
      main,
      `__hostileProbe.text(${sheet}?.renderRoot ?? document.createElement('i'))`,
    ),
  );
  expectVisible(findings, {
    where: 'inline sheet',
    text: sheetText,
    expected: [named?.path ?? '', ...(named?.lines ?? [])],
  });
  await expectSafe(run, main, 'inline sheet');
  await shoot(main, 'sheet-inline');
}

/** Opens the hostile lines in a sheet window and checks that window. */
async function checkSheetWindow(
  run: Run,
  main: SessionId,
  repository: HostileRepository,
): Promise<void> {
  const { devtools, findings, shoot } = run;
  const app = "document.querySelector('beuve-app')";
  const { contents } = repository;
  await chooseSheets(devtools, main, 'window');
  const line = contents.line - 1;
  await devtools.evaluate(
    main,
    `${app}.sheetAction({ kind: 'open', path: ${JSON.stringify(contents.path)}, range: { startLine: ${String(line)}, startCharacter: 0, endLine: ${String(line)}, endCharacter: 1 } })`,
  );
  const sheet = await devtools.waitForPage((url) => {
    return url.includes('/sheet.html');
  }, wait());
  await devtools.waitFor(sheet, "!!document.querySelector('beuve-sheet-view')", wait());
  await devtools.evaluate(sheet, pageProbe);
  if ((await eventually(devtools, sheet, '__hostileProbe.rows() > 0')) === undefined) {
    findings.failures.push('sheet window rendered no rows');
  }
  const text = String(await devtools.evaluate(sheet, '__hostileProbe.text()'));
  expectVisible(findings, {
    where: 'sheet window',
    text,
    expected: [
      contents.path,
      ...(repository.files.find((file) => file.path === contents.path)?.lines ?? []),
    ],
  });
  await expectSafe(run, sheet, 'sheet window');
  await shoot(sheet, 'sheet-window');
}

async function checkSettingsWindow(run: Run, main: SessionId): Promise<void> {
  const { devtools, shoot } = run;
  await devtools.evaluate(main, "document.querySelector('beuve-app').runCommandId('settings')");
  const settings = await devtools.waitForPage((url) => {
    return url.includes('/settings.html');
  }, wait());
  await devtools.waitFor(
    settings,
    "document.querySelector('beuve-settings-view')?.renderRoot?.textContent?.length > 50",
    wait(),
  );
  await devtools.evaluate(settings, pageProbe);
  await expectSafe(run, settings, 'settings window');
  await shoot(settings, 'settings');
}

/**
 * The harness page has exactly the app's CSP, and nothing of the test build is in `dist/`, which
 * electron-builder packages.
 */
async function checkTestBuild(findings: Findings): Promise<void> {
  const policyOf = async (page: string): Promise<string> => {
    return cspMeta.exec(await readFile(path.join(root, page), 'utf8'))?.[1] ?? '';
  };
  const [app, harness] = await Promise.all([
    policyOf('dist/ui/index.html'),
    policyOf('dist-test/ui/hostile-harness.html'),
  ]);
  if (app === '' || app !== harness) {
    findings.failures.push(
      `the harness page's CSP ${JSON.stringify(harness)} is not the app's ${JSON.stringify(app)}`,
    );
  }
  const shipped = await readdir(path.join(root, 'dist'), { recursive: true });
  expectNone(
    findings,
    'test build file in dist/',
    shipped.filter((file) => testBuildFile.test(file)),
  );
}

/**
 * Navigates the main window, with its production web preferences, to the test build's harness
 * page (`node scripts/build.ts --hostile-harness`), which has `index.html`'s CSP and installs
 * the same policy, and installs the probe there.
 */
async function openHarness(devtools: DevtoolsConnection, main: SessionId): Promise<SessionId> {
  const page = path.join(root, 'dist-test/ui/hostile-harness.html');
  await devtools.send('Page.navigate', { url: pathToFileURL(page).href }, main);
  const harness = await devtools.waitForPage((url) => {
    return url.endsWith('/hostile-harness.html');
  }, wait());
  await devtools.waitFor(harness, "typeof globalThis.hostileHarness === 'object'", wait());
  await devtools.evaluate(harness, pageProbe);
  return harness;
}

/**
 * Renders each group of the shared corpus (`src/ui/testing/hostile-corpus.ts`, as the Node test
 * does) through the real components in the harness page and fails on any case's verdict, on a
 * group with fewer verdicts than the corpus has cases, and on unsafe markup while the group is
 * mounted. Then it splices each hostile string unescaped into library-like HTML and assigns it
 * through the page's default policy: the sanitizer must leave nothing unsafe, whatever a library
 * escaping bug would let through.
 */
async function checkHarness(run: Run, harness: SessionId): Promise<void> {
  const { devtools, findings, shoot } = run;
  const corpus = hostileCorpus();
  const groups = (await devtools.evaluate(harness, 'hostileHarness.groups()')) as readonly (
    | 'fileNames'
    | 'renames'
    | 'lines'
    | 'hunkContexts'
    | 'shownHunkContexts'
    | 'diffLanguages'
    | 'sheets'
    | 'codeBlocks'
    | 'sheetLanguages'
  )[];
  // Each `createPolicy` that `checkPolicy` refused is reported as a violation too: expected.
  const seen = findings.violations.length;
  let cases = 0;
  for (const group of groups) {
    const verdicts = (await devtools.evaluate(
      harness,
      `hostileHarness.run(${JSON.stringify(group)})`,
    )) as readonly { readonly title: string; readonly failures: readonly string[] }[];
    cases += verdicts.length;
    if (verdicts.length !== corpus[group].length) {
      findings.failures.push(
        `harness ${group}: ${String(verdicts.length)} verdicts for ${String(corpus[group].length)} cases`,
      );
    }
    for (const { title, failures } of verdicts) {
      expectNone(findings, `harness ${title}`, failures);
    }
    await expectSafe(run, harness, `harness ${group}`);
    await shoot(harness, `harness-${group}`);
    await devtools.evaluate(harness, 'hostileHarness.clear()');
  }
  expectNone(
    findings,
    'Content Security Policy violation in the harness page',
    findings.violations.slice(seen).map((violation) => JSON.stringify(violation)),
  );
  const beforeSplice = findings.violations.length;
  const spliced = [...corpus.names, ...corpus.contents].map(({ text }) => {
    return `<div data-title="${text}"><span data-diff-span="">${text}</span></div>`;
  });
  await devtools.evaluate(harness, `__hostileProbe.mount(${JSON.stringify(spliced.join(''))})`);
  await delay(300);
  await expectSafe(run, harness, 'hostile strings spliced unescaped into a sink');
  // The sanitizer's parse reports each event handler it drops as `script-src-attr`; nothing runs.
  expectNone(
    findings,
    'Content Security Policy violation from the spliced strings',
    findings.violations
      .slice(beforeSplice)
      .filter((violation) => violation.directive !== 'script-src-attr')
      .map((violation) => JSON.stringify(violation)),
  );
  await devtools.evaluate(harness, 'hostileHarness.clear()');
  findings.notes.push(`the harness rendered ${String(cases)} cases of the shared corpus`);
}

/**
 * The default policy's sanitizer on markup the libraries never produce, that no other policy can
 * be created (each attempt is itself reported as a `trusted-types` violation, which is expected
 * here), and that the only script URL is the highlighting worker's.
 */
async function checkPolicy(
  devtools: DevtoolsConnection,
  main: SessionId,
  findings: Findings,
): Promise<void> {
  for (const { label, input, output } of sanitizerCases()) {
    const actual = await devtools.evaluate(
      main,
      `__hostileProbe.sanitize(${JSON.stringify(input)})`,
    );
    if (actual !== output) {
      findings.failures.push(
        `sanitizer, ${label}: ${JSON.stringify(input)} became ${JSON.stringify(actual)}, not ${JSON.stringify(output)}`,
      );
    }
  }
  const attempts = await devtools.evaluate(
    main,
    `['default', 'beuve-sanitizer-input', 'lit-html', 'beuve-other'].map((name) => {
    try { trustedTypes.createPolicy(name, { createHTML: (s) => s }); return name + ': created'; }
    catch (error) { return name + ': ' + error.name; }
  })`,
  );
  expectEqual(findings, 'creating another policy', {
    actual: attempts,
    expected: [
      'default: TypeError',
      'beuve-sanitizer-input: TypeError',
      'lit-html: TypeError',
      'beuve-other: TypeError',
    ],
  });
  const scriptUrls = await devtools.evaluate(
    main,
    `['https://evil.example/x.js', 'data:text/javascript,1', 'diff-worker/worker.js'].map((url) => {
    try { return String(trustedTypes.defaultPolicy.createScriptURL(url)) === url ? 'allowed' : 'changed'; }
    catch (error) { return error.name; }
  })`,
  );
  expectEqual(findings, 'script URLs', {
    actual: scriptUrls,
    expected: ['TypeError', 'TypeError', 'allowed'],
  });
  const reachable = await devtools.evaluate(
    main,
    `Object.getOwnPropertyNames(globalThis).filter((key) => {
    try { const value = globalThis[key]; return value && typeof value === 'object' && value.name === 'beuve-sanitizer-input'; }
    catch { return false; }
  })`,
  );
  expectEqual(findings, 'globals holding the pass-through policy', {
    actual: reachable,
    expected: [],
  });
}

/** Exact outputs from Chromium 156's Sanitizer with the default policy's configuration. */
function sanitizerCases(): readonly SanitizerCase[] {
  return [
    { label: 'img onerror', input: '<img src="x" onerror="alert(1)">', output: '<img src="x">' },
    { label: 'javascript: link', input: '<a href="javascript:alert(1)">x</a>t', output: 't' },
    {
      label: 'use outside the document',
      input: '<svg><use href="//evil.example/#x"></use><use href="#ok"></use></svg>',
      output: '<svg><use href="#ok"></use></svg>',
    },
    {
      label: 'use with xlink:href',
      input: '<svg><use href="#ok" xlink:href="//evil.example/#x"></use></svg>',
      output: '<svg></svg>',
    },
    {
      label: 'form and formaction',
      input:
        '<form action="javascript:alert(1)"><input></form><button formaction="javascript:alert(1)" form="f">b</button>',
      output: '<button>b</button>',
    },
    {
      label: 'SVG animation',
      input:
        '<svg><a href="#"><animate attributeName="href" to="javascript:alert(1)"></animate><set attributeName="href" to="javascript:alert(1)"></set><text>t</text></a><animateMotion></animateMotion><animateTransform></animateTransform></svg>',
      output: '<svg></svg>',
    },
    {
      label: 'foreignObject script',
      input: '<svg><foreignObject><script>alert(1)</script><b>t</b></foreignObject></svg>',
      output: '<svg><foreignObject><b>t</b></foreignObject></svg>',
    },
    {
      label: 'frames and plugins',
      input:
        '<iframe srcdoc="<script>alert(1)</script>"></iframe><object data="x"></object><embed src="x"><b>t</b>',
      output: '<b>t</b>',
    },
    {
      label: 'what the libraries produce',
      input:
        '<div data-line="1" style="color: red"><span data-diff-span="">t</span></div><button data-utility-button="" type="button"><svg><use href="#diffs-icon-plus"></use></svg></button><style>a{}</style>',
      output:
        '<div data-line="1" style="color: red"><span data-diff-span="">t</span></div><button data-utility-button="" type="button"><svg><use href="#diffs-icon-plus"></use></svg></button><style>a{}</style>',
    },
  ];
}

async function expectSafe(
  { devtools, findings }: Run,
  sessionId: SessionId,
  where: string,
): Promise<void> {
  const unsafe = (await devtools.evaluate(
    sessionId,
    '__hostileProbe.unsafe()',
  )) as readonly string[];
  expectNone(findings, `${where}: unsafe markup`, unsafe);
}

function expectVisible(findings: Findings, { where, text, expected }: TextCheck): void {
  for (const entry of expected) {
    if (!text.includes(entry)) {
      findings.failures.push(`${where}: ${JSON.stringify(entry)} is not visible as text`);
    }
  }
}

function expectNone(findings: Findings, what: string, found: readonly string[]): void {
  for (const entry of found) {
    findings.failures.push(`${what}: ${entry}`);
  }
}

function expectEqual(findings: Findings, what: string, { actual, expected }: Comparison): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    findings.failures.push(`${what}: ${JSON.stringify(actual)}, not ${JSON.stringify(expected)}`);
  }
}

function report(findings: Findings, output: string): void {
  for (const note of findings.notes) {
    console.log(`note: ${note}`);
  }
  if (findings.failures.length === 0) {
    console.log(
      'hostile render: every window rendered hostile names and contents as text, with no violation',
    );
    return;
  }
  for (const failure of findings.failures) {
    console.error(`FAIL ${failure}`);
  }
  console.error(`\napp output:\n${output}`);
  process.exitCode = 1;
}
