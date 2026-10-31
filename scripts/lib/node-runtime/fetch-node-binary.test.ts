import { execFile } from 'node:child_process';
import { hash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';
import { test } from '#testing/test.ts';

import { fetchNodeBinary } from './fetch-node-binary.ts';
import type { FetchNodeBinaryOptions } from './fetch-node-binary.ts';

interface FakeRelease {
  readonly options: FetchNodeBinaryOptions;
  /** Every URL `download` was asked for. */
  readonly downloads: string[];
}

describe('fetchNodeBinary', () => {
  test('verifies the archive and extracts only node', async ({ expect, tempDir, signal }) => {
    const release = await fakeRelease(tempDir, signal);

    const fetched = okValueFrom(await fetchNodeBinary(release.options));

    expect(fetched).toStrictEqual({
      binary: path.join(tempDir, 'out', 'node'),
      downloaded: true,
      extracted: true,
    });
    expect(release.downloads).toStrictEqual([
      'https://dist.test/v26.0.1/node-v26.0.1-linux-x64.tar.xz',
    ]);
    await expect(readFile(fetched.binary, { encoding: 'utf8', signal })).resolves.toBe(
      '#!/bin/sh\necho v26.0.1\n',
    );
    await expect(readdir(path.join(tempDir, 'out'))).resolves.toStrictEqual([
      'node',
      'node.source',
    ]);
    await expect(readdir(path.join(tempDir, 'cache'))).resolves.toStrictEqual([
      'node-v26.0.1-linux-x64.tar.xz',
    ]);
  });

  test('downloads and extracts nothing the second time', async ({ expect, tempDir, signal }) => {
    const release = await fakeRelease(tempDir, signal);
    okValueFrom(await fetchNodeBinary(release.options));

    const again = await fetchNodeBinary(release.options);

    expect(again).toStrictEqual({
      ok: true,
      value: { binary: path.join(tempDir, 'out', 'node'), downloaded: false, extracted: false },
    });
    expect(release.downloads).toHaveLength(1);
  });

  test('extracts again when the binary is gone', async ({ expect, tempDir, signal }) => {
    const release = await fakeRelease(tempDir, signal);
    okValueFrom(await fetchNodeBinary(release.options));
    await writeFile(path.join(tempDir, 'out', 'node.source'), 'another archive\n', { signal });

    const again = okValueFrom(await fetchNodeBinary(release.options));

    expect(again).toMatchObject({ downloaded: false, extracted: true });
  });

  test('refuses an archive whose hash is not the pinned one', async ({
    expect,
    tempDir,
    signal,
  }) => {
    const release = await fakeRelease(tempDir, signal);
    const pinned = '0'.repeat(64);

    const fetched = await fetchNodeBinary({ ...release.options, sha256: pinned });

    expect(fetched).toMatchObject({
      ok: false,
      error: { kind: 'checksum-mismatch', expected: pinned },
    });
    await expect(readdir(path.join(tempDir, 'cache'))).resolves.toStrictEqual([]);
    await expect(readdir(tempDir)).resolves.not.toContain('out');
  });

  test('reports a failed download', async ({ expect, tempDir, signal }) => {
    const release = await fakeRelease(tempDir, signal);

    const fetched = await fetchNodeBinary({
      ...release.options,
      download: async (_url, { destination }): Promise<void> => {
        await writeFile(destination, 'partial', { signal });
        throw new Error('offline');
      },
    });

    expect(fetched).toStrictEqual({
      ok: false,
      error: {
        kind: 'download-failed',
        url: 'https://dist.test/v26.0.1/node-v26.0.1-linux-x64.tar.xz',
        message: 'offline',
      },
    });
    await expect(readdir(path.join(tempDir, 'cache'))).resolves.toStrictEqual([]);
  });
});

/** A `node-v26.0.1-linux-x64.tar.xz` with a fake `bin/node` and files that must stay behind. */
async function fakeRelease(tempDir: string, signal: AbortSignal): Promise<FakeRelease> {
  const tree = path.join(tempDir, 'tree');
  const top = path.join(tree, 'node-v26.0.1-linux-x64');
  await mkdir(path.join(top, 'bin'), { recursive: true });
  await mkdir(path.join(top, 'include'));
  await writeFile(path.join(top, 'bin', 'node'), '#!/bin/sh\necho v26.0.1\n', { signal });
  await writeFile(path.join(top, 'bin', 'npm'), 'npm', { signal });
  await writeFile(path.join(top, 'include', 'node.h'), 'header', { signal });
  const archive = path.join(tempDir, 'release.tar.xz');
  await promisify(execFile)(
    'tar',
    ['-c', '-J', '-f', archive, '-C', tree, 'node-v26.0.1-linux-x64'],
    {
      signal,
    },
  );
  const sha256 = hash('sha256', await readFile(archive, { signal }));
  const downloads: string[] = [];
  return {
    downloads,
    options: {
      version: '26.0.1',
      target: 'linux-x64',
      sha256,
      cacheDirectory: path.join(tempDir, 'cache'),
      outputDirectory: path.join(tempDir, 'out'),
      baseUrl: 'https://dist.test',
      signal,
      download: async (url, { destination }): Promise<void> => {
        downloads.push(url);
        await copyFile(archive, destination);
      },
    },
  };
}
