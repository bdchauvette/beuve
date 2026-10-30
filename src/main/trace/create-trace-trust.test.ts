import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openRepository } from '#internal/git/open-repository.ts';
import type { GitRepository } from '#internal/git/open-repository.ts';
import { createTestRepository } from '#internal/git/testing/create-test-repository.ts';
import type { TestRepository } from '#internal/git/testing/test-repository.ts';

import { createTraceTrust } from './create-trace-trust.ts';

describe('createTraceTrust', () => {
  let repo: TestRepository;
  let git: GitRepository;
  let directory: string;
  let settingsPath: string;
  beforeEach(async () => {
    vi.useFakeTimers({
      toFake: ['Date', 'Temporal'],
      now: Temporal.Instant.from('2026-10-28T12:00:00Z'),
    });
    repo = createTestRepository();
    repo.write('a.txt', 'a\n');
    repo.commit('first');
    const opened = await openRepository(repo.directory);
    if (!opened.ok) {
      throw new Error(opened.error.kind);
    }
    git = opened.value;
    directory = mkdtempSync(path.join(os.tmpdir(), 'beuve-trust-'));
    settingsPath = path.join(directory, 'settings.json');
  });

  afterEach(() => {
    vi.useRealTimers();
    repo.cleanup();
    rmSync(directory, { recursive: true, force: true });
  });

  it('trusts nothing by default and keeps approvals in settings.json beside other keys', async () => {
    writeFileSync(settingsPath, JSON.stringify({ preferredEditor: 'zed' }));
    const trust = createTraceTrust({ settingsPath });
    await expect(trust.status(git)).resolves.toEqual({
      trusted: false,
      repositoryPath: repo.directory,
    });

    await expect(trust.grant(git)).resolves.toEqual({
      trusted: true,
      repositoryPath: repo.directory,
    });
    const fresh = createTraceTrust({ settingsPath });
    await expect(fresh.status(git)).resolves.toMatchObject({ trusted: true });
    expect(JSON.parse(readFileSync(settingsPath, 'utf8'))).toEqual({
      preferredEditor: 'zed',
      traceTrustedRepositories: { [repo.directory]: { trustedAt: '2026-10-28T12:00:00.000Z' } },
    });

    await expect(fresh.revoke(git)).resolves.toMatchObject({ trusted: false });
    expect(JSON.parse(readFileSync(settingsPath, 'utf8'))).toEqual({
      preferredEditor: 'zed',
      traceTrustedRepositories: {},
    });
  });

  it('keys the approval by real path and withdraws it when the recorded remote is gone', async () => {
    repo.git('remote', 'add', 'origin', 'https://github.com/acme/widgets.git');
    const trust = createTraceTrust({ settingsPath });
    await expect(trust.grant(git)).resolves.toMatchObject({
      trusted: true,
      remoteUrl: 'https://github.com/acme/widgets.git',
    });
    const stored = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
      traceTrustedRepositories: Record<string, unknown>;
    };
    expect(stored.traceTrustedRepositories[repo.directory]).toEqual({
      trustedAt: '2026-10-28T12:00:00.000Z',
      remoteUrl: 'https://github.com/acme/widgets.git',
    });

    repo.git('remote', 'set-url', 'origin', 'https://github.com/evil/widgets.git');
    await expect(trust.status(git)).resolves.toMatchObject({ trusted: false });
    repo.git('remote', 'remove', 'origin');
    await expect(trust.status(git)).resolves.toMatchObject({ trusted: false });
  });

  it('keeps approvals in memory without a settings file and ignores malformed entries', async () => {
    const memory = createTraceTrust({});
    await expect(memory.grant(git)).resolves.toMatchObject({ trusted: true });
    await expect(memory.revoke(git)).resolves.toMatchObject({ trusted: false });

    writeFileSync(
      settingsPath,
      JSON.stringify({ traceTrustedRepositories: { [repo.directory]: 'yes' } }),
    );
    await expect(createTraceTrust({ settingsPath }).status(git)).resolves.toMatchObject({
      trusted: false,
    });
  });
});
