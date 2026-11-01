import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { parseArgs } from 'node:util';

import { errorFrom } from '../src/x/error/error-from.ts';

import { readFuseWire } from './lib/fuses/read-fuse-wire.ts';
import type { FuseState } from './lib/fuses/read-fuse-wire.ts';
import packageJson from '../package.json' with { type: 'json' };
import pinned from './node-runtime.json' with { type: 'json' };

/** Electron's fuse order (`FuseV1Options` in `@electron/fuses`) and what beuve expects. */
const expectedFuses: readonly (readonly [string, FuseState | undefined])[] = [
  ['runAsNode', 'disabled'],
  ['enableCookieEncryption', 'enabled'],
  ['enableNodeOptionsEnvironmentVariable', 'disabled'],
  ['enableNodeCliInspectArguments', 'disabled'],
  ['enableEmbeddedAsarIntegrityValidation', 'enabled'],
  ['onlyLoadAppFromAsar', 'enabled'],
  ['loadBrowserProcessSpecificV8Snapshot', 'disabled'],
  ['grantFileProtocolExtraPrivileges', 'enabled'],
  // Not settable through electron-builder; Electron's default stays.
  ['wasmTrapHandlers', undefined],
];
const runFile = promisify(execFile);

await checkPackagedApp();

/**
 * Checks a packaged beuve (ADR 0083, 0084): reads the fuse wire from the built binary and
 * compares it with `electron-builder.yml`'s `electronFuses` (above, kept in step by hand), and
 * runs the bundled `resources/node/node` to check it is the pinned Node with `Temporal`. Pass
 * `--app out/linux-unpacked` or `--app out/mac-arm64/beuve.app`. Exits non-zero on any mismatch.
 */
async function checkPackagedApp(): Promise<void> {
  const { values } = parseArgs({ options: { app: { type: 'string' } } });
  if (values.app === undefined) {
    console.error('check-packaged-app: pass --app <out/linux-unpacked | out/mac-arm64/beuve.app>');
    process.exitCode = 1;
    return;
  }
  const layout = layoutOf(path.resolve(values.app));
  const failures = [
    ...(await checkFuses(layout.fuseBinary)),
    ...(await checkNode(layout.node)),
    ...(await checkCorepack(layout)),
  ];
  for (const failure of failures) {
    console.error(`check-packaged-app: FAIL ${failure}`);
  }
  if (failures.length === 0) {
    process.exitCode = 0;
  } else {
    process.exitCode = 1;
  }
}

/** Where a packaged app keeps the binary whose fuses are checked, its bundled Node and corepack. */
interface AppLayout {
  readonly fuseBinary: string;
  readonly node: string;
  readonly corepack: string;
}

function layoutOf(app: string): AppLayout {
  if (app.endsWith('.app')) {
    return {
      fuseBinary: path.join(
        app,
        'Contents/Frameworks/Electron Framework.framework/Electron Framework',
      ),
      node: path.join(app, 'Contents/Resources/node/node'),
      corepack: path.join(app, corepackInResources('Contents/Resources')),
    };
  }
  return {
    fuseBinary: path.join(app, 'beuve'),
    node: path.join(app, 'resources/node/node'),
    corepack: path.join(app, corepackInResources('resources')),
  };
}

async function checkFuses(binary: string): Promise<string[]> {
  const wire = readFuseWire(await readFile(binary));
  if (!wire.ok) {
    return [`${binary}: ${wire.error}`];
  }
  console.log(`check-packaged-app: fuse wire v${String(wire.value.version)} in ${binary}`);
  const failures: string[] = [];
  for (const [index, state] of wire.value.fuses.entries()) {
    const [name, expected] = expectedFuses[index] ?? [`fuse ${String(index)}`, undefined];
    const verdict = verdictOf(state, expected);
    console.log(`  ${name.padEnd(40)} ${state}${verdict}`);
    if (expected !== undefined && state !== expected) {
      failures.push(`fuse ${name} is ${state}, not ${expected}`);
    }
  }
  return failures;
}

function verdictOf(state: FuseState, expected: FuseState | undefined): string {
  if (expected === undefined) {
    return '';
  }
  if (state === expected) {
    return ' ok';
  }
  return ` (want ${expected})`;
}

function corepackInResources(resources: string): string {
  return path.join(resources, 'app.asar.unpacked/node_modules/corepack/dist/corepack.js');
}

/** corepack (ADR 0091) must be unpacked where the bundled Node can run it, at the pinned version. */
async function checkCorepack({ node, corepack }: AppLayout): Promise<string[]> {
  const want = packageJson.dependencies.corepack;
  try {
    const { stdout } = await runFile(node, [corepack, '--version'], {
      env: {},
      encoding: 'utf8',
    });
    const version = stdout.trim();
    console.log(`check-packaged-app: ${corepack}: corepack ${version}`);
    if (version !== want) {
      return [`corepack is ${version}, not the pinned ${want}`];
    }
    return [];
  } catch (error: unknown) {
    return [`${corepack} did not run: ${errorFrom(error).message}`];
  }
}

async function checkNode(node: string): Promise<string[]> {
  const want = `v${pinned.version}`;
  try {
    const { stdout } = await runFile(
      node,
      [
        '-p',
        'process.version + " " + typeof Temporal + " " + process.platform + "-" + process.arch',
      ],
      { env: {}, encoding: 'utf8' },
    );
    const [version, temporal, target] = stdout.trim().split(' ', 3);
    console.log(`check-packaged-app: ${node}: Node ${String(version)} on ${String(target)}`);
    const failures: string[] = [];
    if (version !== want) {
      failures.push(`${node} is Node ${String(version)}, not the pinned ${want}`);
    }
    if (temporal !== 'object') {
      failures.push(`${node} has no Temporal`);
    }
    return failures;
  } catch (error: unknown) {
    return [`${node} did not run: ${errorFrom(error).message}`];
  }
}
