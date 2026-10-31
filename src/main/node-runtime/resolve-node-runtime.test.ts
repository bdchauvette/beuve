import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { test } from '../testing/test.ts';
import { resolveNodeRuntime } from './resolve-node-runtime.ts';

describe('resolveNodeRuntime', () => {
  test('uses only the bundled node in a packaged app', async ({ expect, tempDir, signal }) => {
    const resources = path.join(tempDir, 'resources');
    const bundled = await writeFakeNode(
      { directory: path.join(resources, 'node'), version: 'v26.13.0' },
      signal,
    );
    const onPath = await writeFakeNode(
      { directory: path.join(tempDir, 'bin'), version: 'v27.0.0' },
      signal,
    );

    const resolved = await resolveNodeRuntime({
      packaged: true,
      resourcesPath: resources,
      pathVariable: path.dirname(onPath),
      signal,
    });

    expect(resolved).toStrictEqual({
      ok: true,
      value: { command: bundled, version: '26.13.0', source: 'bundled' },
    });
  });

  test('never falls back to PATH when the bundled node is missing', async ({
    expect,
    tempDir,
    signal,
  }) => {
    const onPath = await writeFakeNode(
      { directory: path.join(tempDir, 'bin'), version: 'v26.13.0' },
      signal,
    );
    const resources = path.join(tempDir, 'resources');

    const resolved = await resolveNodeRuntime({
      packaged: true,
      resourcesPath: resources,
      pathVariable: path.dirname(onPath),
      signal,
    });

    expect(resolved).toStrictEqual({
      ok: false,
      error: {
        kind: 'missing',
        source: 'bundled',
        searched: [path.join(resources, 'node', 'node')],
      },
    });
  });

  test('takes the first executable node on PATH when unpackaged', async ({
    expect,
    tempDir,
    signal,
  }) => {
    const notExecutable = path.join(tempDir, 'plain');
    await mkdir(notExecutable);
    await writeFile(path.join(notExecutable, 'node'), 'not a program', { signal });
    const first = await writeFakeNode(
      { directory: path.join(tempDir, 'first'), version: 'v26.1.0' },
      signal,
    );
    const second = await writeFakeNode(
      { directory: path.join(tempDir, 'second'), version: 'v27.0.0' },
      signal,
    );

    const resolved = await resolveNodeRuntime({
      packaged: false,
      resourcesPath: path.join(tempDir, 'unused'),
      pathVariable: [
        'relative/bin',
        notExecutable,
        path.join(tempDir, 'absent'),
        path.dirname(first),
        path.dirname(second),
      ].join(path.delimiter),
      signal,
    });

    expect(resolved).toStrictEqual({
      ok: true,
      value: { command: first, version: '26.1.0', source: 'path' },
    });
  });

  test('says when there is no node on PATH', async ({ expect, tempDir, signal }) => {
    const empty = path.join(tempDir, 'empty');
    await mkdir(empty);

    const resolved = await resolveNodeRuntime({
      packaged: false,
      resourcesPath: tempDir,
      pathVariable: empty,
      signal,
    });

    expect(resolved).toStrictEqual({
      ok: false,
      error: { kind: 'missing', source: 'path', searched: [path.join(empty, 'node')] },
    });
  });

  test('refuses a node older than the minimum, by default the .node-version', async ({
    expect,
    tempDir,
    signal,
  }) => {
    const nodeVersion = await readFile(nodeVersionFile(), { encoding: 'utf8', signal });
    const major = Number(nodeVersion.trim());
    const old = await writeFakeNode(
      { directory: path.join(tempDir, 'old'), version: `v${String(major - 1)}.22.0` },
      signal,
    );
    const current = await writeFakeNode(
      { directory: path.join(tempDir, 'current'), version: `v${String(major)}.0.0` },
      signal,
    );

    const refused = await resolveNodeRuntime({
      packaged: false,
      resourcesPath: tempDir,
      pathVariable: path.dirname(old),
      signal,
    });
    const accepted = await resolveNodeRuntime({
      packaged: false,
      resourcesPath: tempDir,
      pathVariable: path.dirname(current),
      signal,
    });

    expect(refused).toStrictEqual({
      ok: false,
      error: {
        kind: 'too-old',
        command: old,
        version: `${String(major - 1)}.22.0`,
        minimumMajor: major,
      },
    });
    expect(okValueFrom(accepted).version).toBe(`${String(major)}.0.0`);
  });

  test.for([
    {
      label: 'prints something else',
      script: '#!/bin/sh\necho hello\n',
      reason: 'printed "hello"',
    },
    { label: 'fails', script: '#!/bin/sh\necho broken >&2\nexit 3\n', reason: 'Command failed' },
  ])('reports a node that $label', async ({ script, reason }, { expect, tempDir, signal }) => {
    const directory = path.join(tempDir, 'bin');
    await mkdir(directory);
    const command = path.join(directory, 'node');
    await writeFile(command, script, { signal });
    await chmod(command, 0o755);

    const resolved = await resolveNodeRuntime({
      packaged: false,
      resourcesPath: tempDir,
      pathVariable: directory,
      signal,
    });

    expect(resolved).toStrictEqual({
      ok: false,
      error: { kind: 'unrunnable', command, reason: expect.stringContaining(reason) as string },
    });
  });

  test('runs node --version without the inherited environment', async ({
    expect,
    tempDir,
    signal,
  }) => {
    const directory = path.join(tempDir, 'bin');
    await mkdir(directory);
    const command = path.join(directory, 'node');
    await writeFile(command, '#!/bin/sh\necho "v26.0.0${HOME:+-inherited}"\n', { signal });
    await chmod(command, 0o755);

    const resolved = await resolveNodeRuntime({
      packaged: false,
      resourcesPath: tempDir,
      pathVariable: directory,
      signal,
    });

    expect(okValueFrom(resolved).version).toBe('26.0.0');
  });
});

/** Where a fake `node` goes, and the version it prints. */
interface FakeNode {
  readonly directory: string;
  readonly version: string;
}

/** Writes `<directory>/node`, a shell script that prints `version` like `node --version`. */
async function writeFakeNode(
  { directory, version }: FakeNode,
  signal: AbortSignal,
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const command = path.join(directory, 'node');
  await writeFile(command, `#!/bin/sh\necho ${version}\n`, { signal });
  await chmod(command, 0o755);
  return command;
}

function nodeVersionFile(): string {
  return path.join(import.meta.dirname, '..', '..', '..', '.node-version');
}
