import { execFile } from 'node:child_process';
import { cp, mkdtempDisposable, open, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { parseArgs } from 'node:util';

import { errorFrom } from '../src/x/error/error-from.ts';

import { readFuseWire } from './lib/fuses/read-fuse-wire.ts';
import type { FuseState } from './lib/fuses/read-fuse-wire.ts';
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
    ...(await checkNodePty(layout)),
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

/** Where a packaged app keeps the binary whose fuses are checked, its bundled Node and node-pty. */
interface AppLayout {
  readonly fuseBinary: string;
  readonly node: string;
  readonly nodePty: string;
}

function layoutOf(app: string): AppLayout {
  if (app.endsWith('.app')) {
    return {
      fuseBinary: path.join(
        app,
        'Contents/Frameworks/Electron Framework.framework/Electron Framework',
      ),
      node: path.join(app, 'Contents/Resources/node/node'),
      nodePty: path.join(app, nodePtyInResources('Contents/Resources')),
    };
  }
  return {
    fuseBinary: path.join(app, 'beuve'),
    node: path.join(app, 'resources/node/node'),
    nodePty: path.join(app, nodePtyInResources('resources')),
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

function nodePtyInResources(resources: string): string {
  return path.join(resources, 'app.asar.unpacked/node_modules/node-pty');
}

/**
 * node-pty (ADR 0095) must be unpacked with its native addon and, on macOS, `spawn-helper`: the
 * check runs a shell on a pseudo-terminal with the bundled Node (it is N-API, so any Node loads it).
 *
 * The unpacked files are copied to a scratch directory first. node-pty rewrites `app.asar` to
 * `app.asar.unpacked` in the helper's path, which is right when Electron loads it from the archive
 * but turns the already-unpacked path into `app.asar.unpacked.unpacked`, a helper that does not
 * exist. The copy keeps the shipped files, their permissions and their signatures.
 */
async function checkNodePty({ node, nodePty }: AppLayout): Promise<string[]> {
  const script =
    "const p=require(process.argv[1]).spawn('/bin/sh',['-c','echo pty-ok'],{name:'xterm',cols:80,rows:24});" +
    "let o='';p.onData(d=>{o+=d});p.onExit(()=>{process.stdout.write(o)})";
  try {
    await using scratch = await mkdtempDisposable(path.join(tmpdir(), 'check-packaged-pty-'));
    const copy = path.join(scratch.path, 'node-pty');
    await cp(nodePty, copy, { recursive: true });
    const { stdout } = await runFile(node, ['-e', script, copy], {
      env: {},
      encoding: 'utf8',
    });
    console.log(`check-packaged-app: ${nodePty}: ${stdout.trim()}`);
    if (!stdout.includes('pty-ok')) {
      return [`${nodePty} did not run a shell: ${stdout.trim()}`];
    }
    return [];
  } catch (error: unknown) {
    const helpers = await describeSpawnHelpers(nodePty);
    return [`${nodePty} did not load: ${errorFrom(error).message}\n${helpers}`];
  }
}

/** Each `spawn-helper` node-pty ships, with its permission bits: one that is not executable fails `posix_spawnp`. */
async function describeSpawnHelpers(nodePty: string): Promise<string> {
  const candidates = [path.join(nodePty, 'build', 'Release', 'spawn-helper')];
  try {
    const targets = await readdir(path.join(nodePty, 'prebuilds'));
    for (const target of targets) {
      candidates.push(path.join(nodePty, 'prebuilds', target, 'spawn-helper'));
    }
  } catch {
    // No prebuilds directory: only the compiled helper, if any, exists.
  }
  const lines: string[] = [];
  for (const file of candidates) {
    try {
      await using handle = await open(file, 'r');
      const { mode } = await handle.stat();
      lines.push(`  ${path.relative(nodePty, file)}: mode ${(mode & 0o777).toString(8)}`);
    } catch {
      // Not shipped for this platform.
    }
  }
  if (lines.length === 0) {
    return '  no spawn-helper found';
  }
  return lines.join('\n');
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
