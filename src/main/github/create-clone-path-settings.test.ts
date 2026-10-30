import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe } from 'vitest';

import { createClonePathSettings } from './create-clone-path-settings.ts';
import { test } from '../testing/test.ts';

describe('createClonePathSettings', () => {
  test('remembers a clone per repository, case-insensitively, keeping other settings', async ({
    expect,
    tempDir,
  }) => {
    const file = path.join(tempDir, 'settings.json');
    writeFileSync(file, JSON.stringify({ preferredEditor: 'zed' }));
    const settings = createClonePathSettings(file);
    const repository = { host: 'github.com', owner: 'Octo-Org', repo: 'hello-world' };
    await expect(settings.read(repository)).resolves.toBeUndefined();
    await settings.write(repository, '/work/hello-world');
    await expect(
      createClonePathSettings(file).read({ ...repository, owner: 'octo-org' }),
    ).resolves.toBe('/work/hello-world');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toStrictEqual({
      preferredEditor: 'zed',
      githubClonePaths: { 'github.com/octo-org/hello-world': '/work/hello-world' },
    });
  });

  test('ignores relative paths written by hand', async ({ expect, tempDir }) => {
    const file = path.join(tempDir, 'settings.json');
    writeFileSync(file, JSON.stringify({ githubClonePaths: { 'github.com/o/r': 'relative' } }));
    await expect(
      createClonePathSettings(file).read({ host: 'github.com', owner: 'o', repo: 'r' }),
    ).resolves.toBeUndefined();
  });
});
