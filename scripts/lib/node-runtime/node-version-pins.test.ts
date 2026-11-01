import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe } from 'vitest';

import { test } from '#testing/test.ts';

interface PackageManifest {
  readonly devEngines?: {
    readonly runtime?: {
      readonly name?: string;
      readonly version?: string;
      readonly onFail?: string;
    };
  };
}

interface NodeRuntimePin {
  readonly version: string;
}

describe('the Node version pins', () => {
  test('package.json makes npm fail on any Node but the .node-version', async ({
    expect,
    signal,
  }) => {
    const nodeVersionFile = await readRepoFile('.node-version', signal);
    const nodeVersion = nodeVersionFile.trim();
    const manifest = JSON.parse(await readRepoFile('package.json', signal)) as PackageManifest;

    expect(manifest.devEngines?.runtime).toStrictEqual({
      name: 'node',
      version: nodeVersion,
      onFail: 'error',
    });
  });

  test('the Node shipped in packaged builds is a release of the .node-version', async ({
    expect,
    signal,
  }) => {
    const nodeVersionFile = await readRepoFile('.node-version', signal);
    const nodeVersion = nodeVersionFile.trim();
    const pin = JSON.parse(
      await readRepoFile('scripts/node-runtime.json', signal),
    ) as NodeRuntimePin;

    expect(`${pin.version}.`.startsWith(`${nodeVersion}.`)).toBe(true);
  });
});

async function readRepoFile(relative: string, signal: AbortSignal): Promise<string> {
  const root = path.join(import.meta.dirname, '..', '..', '..');
  return readFile(path.join(root, relative), { encoding: 'utf8', signal });
}
