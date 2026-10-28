import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestRepository } from './create-test-repository.ts';
import type { TestRepository } from './create-test-repository.ts';
import { openRepository } from './open-repository.ts';

describe('openRepository', () => {
  let repo: TestRepository;
  beforeEach(() => {
    repo = createTestRepository();
  });
  afterEach(() => {
    repo.cleanup();
  });

  it('finds the top level from a subdirectory and reports the git version', async () => {
    const nested = path.join(repo.directory, 'a', 'b');
    mkdirSync(nested, { recursive: true });
    const opened = await openRepository(nested);
    expect(opened).toMatchObject({ ok: true, value: { root: repo.directory } });
    if (!opened.ok) {
      return;
    }
    expect(opened.value.version.major).toBeGreaterThanOrEqual(2);
    await expect(opened.value.run(['rev-parse', '--show-prefix'])).resolves.toEqual({
      ok: true,
      value: '\n',
    });
  });

  it('rejects relative paths and non-repositories', async () => {
    await expect(openRepository('repo')).resolves.toMatchObject({
      ok: false,
      error: { kind: 'invalid-argument' },
    });
    await expect(openRepository(repo.scratch())).resolves.toMatchObject({
      ok: false,
      error: { kind: 'not-a-repository' },
    });
  });

  it('refuses a git older than the supported minimum', async () => {
    const fake = path.join(repo.scratch(), 'old-git');
    writeFileSync(fake, '#!/bin/sh\necho "git version 2.20.1"\n');
    chmodSync(fake, 0o755);
    await expect(openRepository(repo.directory, { gitBinary: fake })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'unsupported-git-version',
        found: { major: 2, minor: 20, patch: 1, raw: 'git version 2.20.1' },
        required: '2.36',
      },
    });
  });
});
