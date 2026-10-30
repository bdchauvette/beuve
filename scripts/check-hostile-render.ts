import { mkdir, mkdtempDisposable, realpath, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';

import { errorFrom } from '../src/x/error/error-from.ts';
import { timeoutSignal } from '../src/x/time/timeout-signal.ts';

import { DevtoolsConnection } from './lib/devtools/devtools-connection.ts';
import type { DevtoolsEvent, DevtoolsPage } from './lib/devtools/devtools-connection.ts';
import { launchElectron } from './lib/devtools/launch-electron.ts';
import { createHostileRepository } from './lib/hostile-render/create-hostile-repository.ts';
import type { HostileRepository } from './lib/hostile-render/create-hostile-repository.ts';
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
/** Everything of a page URL up to the build output, which says nothing. */
const beforeDist = /^.*\/dist\//u;

await checkHostileRender();

/**
 * Renders a generated repository of hostile file names and contents in the built app (ADR 0077)
 * and fails unless the diff stream (split and unified), peek, an inline sheet, a sheet window and
 * the Settings window render it with no Content Security Policy violation, no element or attribute
 * that runs script or loads from elsewhere, and every hostile name and line visible as text. Then
 * it checks the Trusted Types default policy's sanitizer and that no second policy can be made.
 *
 * Build first (`npm run build`). On Linux run it under a display, for example
 * `xvfb-run -a -s '-screen 0 1600x1000x24' node scripts/check-hostile-render.ts`; switches after
 * `--` go to Electron (`-- --no-sandbox` only where the sandbox cannot start, such as as root).
 * `--screenshots <dir>` saves a PNG of each step.
 */
async function checkHostileRender(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: { screenshots: { type: 'string' } },
    allowPositionals: true,
  });
  const screenshots =
    values.screenshots === undefined ? undefined : path.resolve(values.screenshots);
  const findings: Findings = { failures: [], violations: [], notes: [] };
  const temporaryRoot = await realpath(os.tmpdir());
  await using temporary = await mkdtempDisposable(path.join(temporaryRoot, 'beuve-hostile-'));
  const repository = await createHostileRepository(path.join(temporary.path, 'repo'), wait());
  await using app = await launchElectron({
    root,
    userDataDir: path.join(temporary.path, 'user-data'),
    args: positionals,
    env: { BEUVE_LOG_LEVEL: 'warn', BEUVE_MCP_PORT: String(await freePort()) },
    signal: wait(),
  });
  using devtools = await DevtoolsConnection.open(app.browserUrl, preparePage);
  devtools.on((event) => {
    recordEvent(event, devtools, findings);
  });
  const shoot = async (sessionId: string, name: string): Promise<void> => {
    if (screenshots === undefined) {
      return;
    }
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
  try {
    console.log('hostile render: the main window');
    const main = await openMainWindow(devtools);
    console.log('hostile render: the diff stream, split and unified');
    await checkDiffStream(devtools, main, repository, findings, shoot);
    console.log('hostile render: peek and an inline sheet');
    await checkPeekAndInlineSheet(devtools, main, repository, findings, shoot);
    console.log('hostile render: a sheet window');
    await checkSheetWindow(devtools, main, repository, findings, shoot);
    console.log('hostile render: the Settings window');
    await checkSettingsWindow(devtools, main, findings, shoot);
    expectNone(
      findings,
      'Content Security Policy violation while rendering',
      findings.violations.map((violation) => JSON.stringify(violation)),
    );
    console.log('hostile render: the policy');
    await checkPolicy(devtools, main, findings);
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
  sessionId: string,
  expression: string,
): Promise<unknown> {
  try {
    return await devtools.waitFor(sessionId, expression, wait());
  } catch {
    return undefined;
  }
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
  return typeof address === 'object' && address !== null ? address.port : 0;
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
  const page = devtools.urlOf(event.sessionId ?? '').replace(beforeDist, '');
  if (event.method === 'Runtime.consoleAPICalled') {
    const args = event.params['args'] as readonly { readonly value?: unknown }[];
    const text = args
      .map((arg) => (typeof arg.value === 'string' ? arg.value : JSON.stringify(arg.value)))
      .join(' ');
    if (text.startsWith(violationMarker)) {
      findings.violations.push(JSON.parse(text.slice(violationMarker.length)) as Violation);
    } else if (event.params['type'] === 'error') {
      findings.notes.push(`console error in ${page}: ${text.slice(0, 300)}`);
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
async function openMainWindow(devtools: DevtoolsConnection): Promise<string> {
  const main = await devtools.waitForPage((url) => url.endsWith('/index.html'), wait());
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
  devtools: DevtoolsConnection,
  main: string,
  repository: HostileRepository,
  findings: Findings,
  shoot: (sessionId: string, name: string) => Promise<void>,
): Promise<void> {
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
      expectVisible(findings, `${view} card ${JSON.stringify(file.path)}`, text, [
        file.path,
        ...(file.oldPath === undefined ? [] : [file.oldPath]),
        ...file.lines,
      ]);
    }
    await expectSafe(devtools, main, findings, `diff stream (${view})`);
    await devtools.evaluate(main, `(${cardOf(repository.contents.path)})?.scrollIntoView()`);
    await delay(300);
    await shoot(main, `stream-${view}-contents`);
    await devtools.evaluate(main, `__hostileProbe.all('beuve-file-card')[0]?.scrollIntoView()`);
    await delay(300);
    await shoot(main, `stream-${view}-names`);
  }
}

function cardOf(filePath: string): string {
  return `__hostileProbe.all('beuve-file-card').find((card) => card.file?.path === ${JSON.stringify(filePath)})`;
}

/** Peeks at the hostile lines, then opens an inline sheet of a hostile-named file. */
async function checkPeekAndInlineSheet(
  devtools: DevtoolsConnection,
  main: string,
  repository: HostileRepository,
  findings: Findings,
  shoot: (sessionId: string, name: string) => Promise<void>,
): Promise<void> {
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
  expectVisible(findings, 'peek', peekText, ['hostileTarget', 'hostileCaller', peek.path]);
  await expectSafe(devtools, main, findings, 'peek');
  await shoot(main, 'peek');
  await devtools.evaluate(main, `${app}.peek = undefined`);

  const named = repository.files.find((file) => file.path === repository.sheet);
  await devtools.evaluate(main, `${app}.runCommandId('sheets-inline')`);
  await delay(300);
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
  expectVisible(findings, 'inline sheet', sheetText, [named?.path ?? '', ...(named?.lines ?? [])]);
  await expectSafe(devtools, main, findings, 'inline sheet');
  await shoot(main, 'sheet-inline');
}

/** Opens the hostile lines in a sheet window and checks that window. */
async function checkSheetWindow(
  devtools: DevtoolsConnection,
  main: string,
  repository: HostileRepository,
  findings: Findings,
  shoot: (sessionId: string, name: string) => Promise<void>,
): Promise<void> {
  const app = "document.querySelector('beuve-app')";
  const { contents } = repository;
  await devtools.evaluate(main, `${app}.runCommandId('sheets-window')`);
  await delay(300);
  const line = contents.line - 1;
  await devtools.evaluate(
    main,
    `${app}.sheetAction({ kind: 'open', path: ${JSON.stringify(contents.path)}, range: { startLine: ${String(line)}, startCharacter: 0, endLine: ${String(line)}, endCharacter: 1 } })`,
  );
  const sheet = await devtools.waitForPage((url) => url.includes('/sheet.html'), wait());
  await devtools.waitFor(sheet, "!!document.querySelector('beuve-sheet-view')", wait());
  await devtools.evaluate(sheet, pageProbe);
  if ((await eventually(devtools, sheet, '__hostileProbe.rows() > 0')) === undefined) {
    findings.failures.push('sheet window rendered no rows');
  }
  const text = String(await devtools.evaluate(sheet, '__hostileProbe.text()'));
  expectVisible(findings, 'sheet window', text, [
    contents.path,
    ...(repository.files.find((file) => file.path === contents.path)?.lines ?? []),
  ]);
  await expectSafe(devtools, sheet, findings, 'sheet window');
  await shoot(sheet, 'sheet-window');
}

async function checkSettingsWindow(
  devtools: DevtoolsConnection,
  main: string,
  findings: Findings,
  shoot: (sessionId: string, name: string) => Promise<void>,
): Promise<void> {
  await devtools.evaluate(main, "document.querySelector('beuve-app').runCommandId('settings')");
  const settings = await devtools.waitForPage((url) => url.includes('/settings.html'), wait());
  await devtools.waitFor(
    settings,
    "document.querySelector('beuve-settings-view')?.renderRoot?.textContent?.length > 50",
    wait(),
  );
  await devtools.evaluate(settings, pageProbe);
  await expectSafe(devtools, settings, findings, 'settings window');
  await shoot(settings, 'settings');
}

/**
 * The default policy's sanitizer on markup the libraries never produce, that no other policy can
 * be created (each attempt is itself reported as a `trusted-types` violation, which is expected
 * here), and that the only script URL is the highlighting worker's.
 */
async function checkPolicy(
  devtools: DevtoolsConnection,
  main: string,
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
  expectEqual(findings, 'creating another policy', attempts, [
    'default: TypeError',
    'beuve-sanitizer-input: TypeError',
    'lit-html: TypeError',
    'beuve-other: TypeError',
  ]);
  const scriptUrls = await devtools.evaluate(
    main,
    `['https://evil.example/x.js', 'data:text/javascript,1', 'diff-worker/worker.js'].map((url) => {
    try { return String(trustedTypes.defaultPolicy.createScriptURL(url)) === url ? 'allowed' : 'changed'; }
    catch (error) { return error.name; }
  })`,
  );
  expectEqual(findings, 'script URLs', scriptUrls, ['TypeError', 'TypeError', 'allowed']);
  const reachable = await devtools.evaluate(
    main,
    `Object.getOwnPropertyNames(globalThis).filter((key) => {
    try { const value = globalThis[key]; return value && typeof value === 'object' && value.name === 'beuve-sanitizer-input'; }
    catch { return false; }
  })`,
  );
  expectEqual(findings, 'globals holding the pass-through policy', reachable, []);
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
  devtools: DevtoolsConnection,
  sessionId: string,
  findings: Findings,
  where: string,
): Promise<void> {
  const unsafe = (await devtools.evaluate(
    sessionId,
    '__hostileProbe.unsafe()',
  )) as readonly string[];
  expectNone(findings, `${where}: unsafe markup`, unsafe);
}

function expectVisible(
  findings: Findings,
  where: string,
  text: string,
  expected: readonly string[],
): void {
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

function expectEqual(findings: Findings, what: string, actual: unknown, expected: unknown): void {
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
