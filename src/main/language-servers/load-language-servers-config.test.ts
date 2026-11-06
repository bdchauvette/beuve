import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { loadLanguageServersConfig } from './load-language-servers-config.ts';

describe('loadLanguageServersConfig', () => {
  test('reads the files that exist, in order, and skips the ones that do not without comment', async ({
    expect,
    tempDir,
    signal,
  }) => {
    const first = path.join(tempDir, 'first.json');
    const second = path.join(tempDir, 'second.json');
    await writeFile(first, '{"servers":{"gopls":{"args":["serve"]}}}', { signal });
    await writeFile(second, '{"servers":{"gopls":{"args":["other"]}}}', { signal });
    const loaded = await loadLanguageServersConfig([
      first,
      path.join(tempDir, 'missing.json'),
      second,
    ]);
    expect(loaded.problems).toStrictEqual([]);
    expect(loaded.layers.map((layer) => layer.servers?.['gopls']?.args)).toStrictEqual([
      ['serve'],
      ['other'],
    ]);
  });

  test('leaves out a file that is not valid, names it, and still uses the others', async ({
    expect,
    tempDir,
    signal,
  }) => {
    const broken = path.join(tempDir, 'broken.json');
    const fine = path.join(tempDir, 'fine.json');
    await writeFile(broken, '{"servers":{"go":{"cmd":"gopls"}}}', { signal });
    await writeFile(fine, '{"servers":{"gopls":{"command":"gopls"}}}', { signal });
    const loaded = await loadLanguageServersConfig([broken, fine]);
    expect(loaded.layers).toHaveLength(1);
    expect(loaded.problems).toHaveLength(1);
    expect(loaded.problems[0]).toContain(broken);
    expect(loaded.problems[0]).toContain('cmd');
  });

  test('says when a path is not a readable file, or is too big', async ({
    expect,
    tempDir,
    signal,
  }) => {
    const directory = path.join(tempDir, 'a-directory');
    await mkdir(directory);
    const big = path.join(tempDir, 'big.json');
    await writeFile(big, ' '.repeat(300 * 1024), { signal });
    const loaded = await loadLanguageServersConfig([directory, big]);
    expect(loaded.layers).toStrictEqual([]);
    expect(loaded.problems).toHaveLength(2);
    expect(loaded.problems[0]).toContain('could not be read');
    expect(loaded.problems[1]).toContain('too big');
  });
});
