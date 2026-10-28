import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createClonePathSettings } from './create-clone-path-settings.ts';

describe('createClonePathSettings', () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(path.join(os.tmpdir(), 'beuve-clones-'));
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('remembers a clone per repository, case-insensitively, keeping other settings', async () => {
    const file = path.join(directory, 'settings.json');
    writeFileSync(file, JSON.stringify({ preferredEditor: 'zed' }));
    const settings = createClonePathSettings(file);
    const repository = { host: 'github.com', owner: 'Octo-Org', repo: 'hello-world' };
    expect(await settings.read(repository)).toBeUndefined();
    await settings.write(repository, '/work/hello-world');
    expect(await createClonePathSettings(file).read({ ...repository, owner: 'octo-org' })).toBe(
      '/work/hello-world',
    );
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      preferredEditor: 'zed',
      githubClonePaths: { 'github.com/octo-org/hello-world': '/work/hello-world' },
    });
  });

  it('ignores relative paths written by hand', async () => {
    const file = path.join(directory, 'settings.json');
    writeFileSync(file, JSON.stringify({ githubClonePaths: { 'github.com/o/r': 'relative' } }));
    expect(
      await createClonePathSettings(file).read({ host: 'github.com', owner: 'o', repo: 'r' }),
    ).toBeUndefined();
  });
});
