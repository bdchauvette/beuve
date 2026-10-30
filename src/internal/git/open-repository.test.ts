import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { gitRunner } from './git-runner.ts';
import { openRepository } from './open-repository.ts';
import { test } from './testing/test.ts';

describe('openRepository', () => {
  test('finds the top level from a subdirectory and reports the git version', async ({
    expect,
    repo,
    signal,
  }) => {
    const nested = path.join(repo.directory, 'a', 'b');
    mkdirSync(nested, { recursive: true });
    const opened = await openRepository(nested, { signal });
    expect(opened).toMatchObject({ ok: true, value: { root: repo.directory } });
    const openedValue = okValueFrom(opened);
    expect(openedValue.version.major).toBeGreaterThanOrEqual(2);
    await expect(
      openedValue[gitRunner].run(['rev-parse', '--show-prefix'], {
        policy: { kind: 'read' },
        signal,
      }),
    ).resolves.toStrictEqual({
      ok: true,
      value: '\n',
    });
  });

  test('bounds every command by its own signal and the call’s', async ({
    expect,
    repo,
    signal,
  }) => {
    const opening = new AbortController();
    const opened = okValueFrom(
      await openRepository(repo.directory, { signal: AbortSignal.any([signal, opening.signal]) }),
    );
    await expect(
      opened[gitRunner].run(['status'], { policy: { kind: 'read' }, signal: AbortSignal.abort() }),
    ).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'aborted', args: ['status'] },
    });
    opening.abort();
    await expect(
      opened[gitRunner].run(['status'], { policy: { kind: 'read' }, signal }),
    ).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'aborted', args: ['status'] },
    });
    await expect(
      opened[gitRunner].exec(['status'], { policy: { kind: 'read' }, signal }),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'aborted' },
    });
  });

  test('rejects relative paths and non-repositories', async ({ expect, repo, signal }) => {
    await expect(openRepository('repo', { signal })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'invalid-argument' },
    });
    await expect(openRepository(repo.scratch(), { signal })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'not-a-repository' },
    });
  });

  test('refuses a git older than the supported minimum', async ({ expect, repo, signal }) => {
    const fake = path.join(repo.scratch(), 'old-git');
    writeFileSync(fake, '#!/bin/sh\necho "git version 2.20.1"\n');
    chmodSync(fake, 0o755);
    await expect(
      openRepository(repo.directory, { gitBinary: fake, signal }),
    ).resolves.toStrictEqual({
      ok: false,
      error: {
        kind: 'unsupported-git-version',
        found: { major: 2, minor: 20, patch: 1, raw: 'git version 2.20.1' },
        required: '2.36',
      },
    });
  });
});
