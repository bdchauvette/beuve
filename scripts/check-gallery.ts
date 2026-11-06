import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

import { errorFrom } from '../src/x/error/error-from.ts';
import { removeTree } from '../src/x/fs/remove-tree.ts';
import { tailOf } from '../src/x/text/tail-of.ts';
import { timeoutSignal } from '../src/x/time/timeout-signal.ts';

import { DevtoolsConnection } from './lib/devtools/devtools-connection.ts';
import type { DevtoolsEvent, SessionId } from './lib/devtools/devtools-connection.ts';
import { launchElectron } from './lib/devtools/launch-electron.ts';

/** What the run found. Any entry fails the check. */
interface Findings {
  readonly failures: string[];
}

/** The gallery page, as the steps address it. */
interface Gallery {
  readonly devtools: DevtoolsConnection;
  readonly page: SessionId;
  /** Where PNGs go, when `--screenshots` names a directory. */
  readonly directory: string | undefined;
}

const root = path.resolve(import.meta.dirname, '..');
const waitSeconds = 60;
const themes = ['light', 'dark'] as const;
const schemes = ['red-green', 'blue-orange', 'neutral'] as const;
const gallery = "document.querySelector('beuve-gallery')";
const menu = `${gallery}.renderRoot.querySelector('beuve-menu')`;
/** Installed before the page's scripts, so no violation goes unseen. */
const violationProbe = `window.__violations = [];
document.addEventListener('securitypolicyviolation', (event) => {
  window.__violations.push(event.effectiveDirective + ' ' + event.blockedURI + ' ' + event.sample);
}, true);`;

await checkGallery();

/**
 * Opens the primitives gallery (ADR 0115) in the built app's window, with the production Content
 * Security Policy, in light and dark and each diff color scheme, then with its menu open and a
 * button showing the focus ring. With `--screenshots <dir>` it saves a full-height PNG of each.
 * The page must report no CSP or Trusted Types violation, uncaught exception or console error.
 *
 * Build first (`node scripts/build.ts --gallery`). On Linux run it under a display, for example
 * `xvfb-run -a -s '-screen 0 1600x1000x24' node scripts/check-gallery.ts`; on macOS run it
 * directly. Switches after `--` go to Electron (`-- --no-sandbox` only where the sandbox cannot
 * start, such as as root).
 */
async function checkGallery(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: { screenshots: { type: 'string' } },
    allowPositionals: true,
  });
  const findings: Findings = { failures: [] };
  const temporaryRoot = await realpath(os.tmpdir());
  const temporary = await mkdtemp(path.join(temporaryRoot, 'beuve-gallery-'));
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(async (): Promise<void> => {
    await removeTree(temporary);
  });
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
  try {
    const main = await devtools.waitForPage((url) => {
      return url.endsWith('/index.html');
    }, wait());
    const url = pathToFileURL(path.join(root, 'dist-test/ui/gallery.html')).href;
    await devtools.send('Page.addScriptToEvaluateOnNewDocument', { source: violationProbe }, main);
    await devtools.send('Page.navigate', { url }, main);
    const page = await devtools.waitForPage((pageUrl) => {
      return pageUrl.endsWith('/gallery.html');
    }, wait());
    await devtools.waitFor(page, `!!${gallery}?.renderRoot?.querySelector('section')`, wait());
    await devtools.send('Emulation.setFocusEmulationEnabled', { enabled: true }, page);
    let directory: string | undefined;
    if (values.screenshots !== undefined) {
      directory = path.resolve(values.screenshots);
    }
    await runSteps({ devtools, page, directory });
    const violations = (await devtools.evaluate(page, 'window.__violations')) as string[];
    findings.failures.push(...violations.map((violation) => `violation: ${violation}`));
  } catch (error) {
    findings.failures.push(
      `the run stopped: ${errorFrom(error).stack ?? errorFrom(error).message}`,
    );
  }
  report(findings, launched.output());
}

async function runSteps(view: Gallery): Promise<void> {
  const { devtools, page } = view;
  for (const theme of themes) {
    await devtools.send(
      'Emulation.setEmulatedMedia',
      { features: [{ name: 'prefers-color-scheme', value: theme }] },
      page,
    );
    for (const scheme of schemes) {
      await devtools.evaluate(
        page,
        `void (document.documentElement.dataset.diffColors = '${scheme}')`,
      );
      await shoot(view, `${theme}-${scheme}`);
    }
  }
  console.log('gallery: every theme and scheme rendered');
  await devtools.evaluate(page, `void ${menu}.querySelector('[slot=trigger]').click()`);
  await devtools.waitFor(page, `${menu}.isOpen`, wait());
  await devtools.evaluate(
    page,
    `void [...${gallery}.renderRoot.querySelectorAll('section:first-of-type .button')].at(-1).focus({ focusVisible: true })`,
  );
  await shoot(view, 'dark-focus');
  console.log('gallery: the menu opens and a button shows the focus ring');
}

/** Saves the whole gallery, not just the window, as `<name>.png`. */
async function shoot(view: Gallery, name: string): Promise<void> {
  const { devtools, page, directory } = view;
  if (directory === undefined) {
    return;
  }
  await mkdir(directory, { recursive: true });
  const height = (await devtools.evaluate(page, `${gallery}.scrollHeight`)) as number;
  await devtools.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1280, height, deviceScaleFactor: 1, mobile: false },
    page,
  );
  const { data } = (await devtools.send('Page.captureScreenshot', { format: 'png' }, page)) as {
    readonly data: string;
  };
  await writeFile(path.join(directory, `${name}.png`), Uint8Array.fromBase64(data));
}

function recordEvent(event: DevtoolsEvent, findings: Findings): void {
  if (event.method === 'Runtime.exceptionThrown') {
    const details = event.params['exceptionDetails'] as {
      readonly text?: string;
      readonly exception?: { readonly description?: string };
    };
    findings.failures.push(
      `uncaught exception: ${(details.exception?.description ?? details.text ?? '').slice(0, 400)}`,
    );
  } else if (event.method === 'Runtime.consoleAPICalled' && event.params['type'] === 'error') {
    const args = event.params['args'] as readonly { readonly description?: string }[];
    findings.failures.push(
      `console error: ${args
        .map((arg) => arg.description ?? '')
        .join(' ')
        .slice(0, 400)}`,
    );
  }
}

function report(findings: Findings, output: string): void {
  if (findings.failures.length === 0) {
    console.log('gallery: no violation, exception or console error');
    return;
  }
  for (const failure of findings.failures) {
    console.error(`FAIL ${failure}`);
  }
  console.error(`the app's output:\n${tailOf(output, 2000)}`);
  process.exitCode = 1;
}

/** A fresh deadline for one wait. */
function wait(): AbortSignal {
  return timeoutSignal(Temporal.Duration.from({ seconds: waitSeconds }));
}
