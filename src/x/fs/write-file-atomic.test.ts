import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { writeFileAtomic } from './write-file-atomic.ts';

describe('writeFileAtomic', () => {
  test('writes the file with its mode', async ({ expect, tempDir, signal }) => {
    const file = path.join(tempDir, 'settings.json');
    await writeFileAtomic(file, '{}\n', { mode: 0o600, signal });
    await expect(readFile(file, { encoding: 'utf8', signal })).resolves.toBe('{}\n');
    await expect(permissionsOf(file)).resolves.toBe(0o600);
    await expect(readdir(tempDir)).resolves.toStrictEqual(['settings.json']);
  });

  test('replaces a looser file with one that has the mode', async ({ expect, tempDir, signal }) => {
    const file = path.join(tempDir, 'token');
    await writeFile(file, 'old\n', { mode: 0o644, signal });
    await writeFileAtomic(file, 'new\n', { mode: 0o600, signal });
    await expect(readFile(file, { encoding: 'utf8', signal })).resolves.toBe('new\n');
    await expect(permissionsOf(file)).resolves.toBe(0o600);
  });

  test('creates the temporary file with the mode and shows no partial file while it writes', async ({
    expect,
    tempDir,
    signal,
  }) => {
    const file = path.join(tempDir, 'secrets.json');
    await writeFile(file, 'old\n', { mode: 0o600, signal });
    const seen: { names: string[]; modes: number[]; contents: string }[] = [];
    async function* chunks(): AsyncGenerator<string> {
      yield 'first half, ';
      const names = await readdir(tempDir);
      const temporary = names.filter((name) => name !== 'secrets.json');
      seen.push({
        names: temporary.map((name) => (name.startsWith('.secrets.json.') ? 'temporary' : name)),
        modes: await Promise.all(temporary.map(async (name) => permissionsOf(tempDir, name))),
        contents: await readFile(file, { encoding: 'utf8', signal }),
      });
      yield 'second half\n';
    }
    await writeFileAtomic(file, chunks(), { mode: 0o600, signal });
    expect(seen).toStrictEqual([{ names: ['temporary'], modes: [0o600], contents: 'old\n' }]);
    await expect(readFile(file, { encoding: 'utf8', signal })).resolves.toBe(
      'first half, second half\n',
    );
    await expect(readdir(tempDir)).resolves.toStrictEqual(['secrets.json']);
  });

  test('leaves the file and no temporary file behind when the write fails', async ({
    expect,
    tempDir,
    signal,
  }) => {
    const file = path.join(tempDir, 'settings.json');
    await writeFile(file, 'old\n', { signal });
    await expect(writeFileAtomic(file, failing(), { mode: 0o600, signal })).rejects.toThrow(
      'disk full',
    );
    await expect(readFile(file, { encoding: 'utf8', signal })).resolves.toBe('old\n');
    await expect(readdir(tempDir)).resolves.toStrictEqual(['settings.json']);
  });

  test('removes the temporary file when the write is aborted', async ({
    expect,
    tempDir,
    signal,
  }) => {
    const file = path.join(tempDir, 'settings.json');
    const controller = new AbortController();
    async function* aborting(): AsyncGenerator<string> {
      yield 'partial';
      controller.abort();
      await Promise.resolve();
      yield 'rest';
    }
    await expect(
      writeFileAtomic(file, aborting(), {
        mode: 0o600,
        signal: AbortSignal.any([signal, controller.signal]),
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await expect(readdir(tempDir)).resolves.toStrictEqual([]);
  });

  test('fails without a temporary file when the directory is missing', async ({
    expect,
    tempDir,
    signal,
  }) => {
    const file = path.join(tempDir, 'missing', 'settings.json');
    await expect(writeFileAtomic(file, '{}', { mode: 0o600, signal })).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(readdir(tempDir)).resolves.toStrictEqual([]);
  });

  test('concurrent writers never interleave: the file is one writer’s contents, whole', async ({
    expect,
    tempDir,
    signal,
  }) => {
    const file = path.join(tempDir, 'settings.json');
    const contents = Array.from({ length: 16 }, (_, index) => payload(index));
    await Promise.all(
      contents.map(async (text) => writeFileAtomic(file, chunked(text), { mode: 0o600, signal })),
    );
    expect(contents).toContain(await readFile(file, { encoding: 'utf8', signal }));
    await expect(readdir(tempDir)).resolves.toStrictEqual(['settings.json']);
  });
});

async function permissionsOf(...segments: string[]): Promise<number> {
  const { mode } = await stat(path.join(...segments));
  return mode & 0o777;
}

async function* failing(): AsyncGenerator<string> {
  yield 'partial';
  await Promise.resolve();
  throw new Error('disk full');
}

/** 64 KiB of one letter per writer, so a mix of two writers would show. */
function payload(index: number): string {
  return String.fromCodePoint(97 + index).repeat(64 * 1024);
}

/** Yields `text` in 4 KiB pieces with a pause between them, so writers overlap. */
async function* chunked(text: string): AsyncGenerator<string> {
  for (let start = 0; start < text.length; start += 4096) {
    await Promise.resolve();
    yield text.slice(start, start + 4096);
  }
}
