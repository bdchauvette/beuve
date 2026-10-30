import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe } from 'vitest';

import { openRepository } from '#internal/git/open-repository.ts';
import type { GitRepository } from '#internal/git/open-repository.ts';
import type { RepositoryTemplate, TestRepository } from '#internal/git/testing/test-repository.ts';
import type { TestRepositories } from '#internal/git/testing/test.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import { test } from '../testing/test.ts';
import { createTraceTrust } from './create-trace-trust.ts';

describe('createTraceTrust', () => {
  test(
    'trusts nothing by default and keeps approvals in settings.json beside other keys',
    { concurrent: false },
    async ({ expect, clock, repositories, tempDir }) => {
      clock.set('2026-10-28T12:00:00Z');
      const { repo, git } = await openFirstCommit(repositories);
      const settingsPath = path.join(tempDir, 'settings.json');
      writeFileSync(settingsPath, JSON.stringify({ preferredEditor: 'zed' }));
      const trust = createTraceTrust({ settingsPath });
      await expect(trust.status(git)).resolves.toStrictEqual({
        trusted: false,
        repositoryPath: repo.directory,
      });

      await expect(trust.grant(git)).resolves.toStrictEqual({
        trusted: true,
        repositoryPath: repo.directory,
      });
      const fresh = createTraceTrust({ settingsPath });
      await expect(fresh.status(git)).resolves.toMatchObject({ trusted: true });
      expect(JSON.parse(readFileSync(settingsPath, 'utf8'))).toStrictEqual({
        preferredEditor: 'zed',
        traceTrustedRepositories: { [repo.directory]: { trustedAt: '2026-10-28T12:00:00.000Z' } },
      });

      await expect(fresh.revoke(git)).resolves.toMatchObject({ trusted: false });
      expect(JSON.parse(readFileSync(settingsPath, 'utf8'))).toStrictEqual({
        preferredEditor: 'zed',
        traceTrustedRepositories: {},
      });
    },
  );

  test(
    'lists stored approvals by path and removes one without opening its repository',
    { concurrent: false },
    async ({ expect, clock, repositories, tempDir }) => {
      clock.set('2026-10-28T12:00:00Z');
      const { repo, git } = await openFirstCommit(repositories);
      const settingsPath = path.join(tempDir, 'settings.json');
      const gone = path.join(tempDir, 'moved-away');
      writeFileSync(
        settingsPath,
        JSON.stringify({
          traceTrustedRepositories: { [gone]: { trustedAt: '2026-10-01T09:00:00.000Z' }, bad: 3 },
        }),
      );
      const trust = createTraceTrust({ settingsPath });
      await trust.grant(git);
      await expect(trust.list()).resolves.toStrictEqual(
        [
          { repositoryPath: gone, trustedAt: '2026-10-01T09:00:00.000Z' },
          { repositoryPath: repo.directory, trustedAt: '2026-10-28T12:00:00.000Z' },
        ].toSorted((left, right) => left.repositoryPath.localeCompare(right.repositoryPath)),
      );
      await expect(trust.remove(gone)).resolves.toStrictEqual([
        { repositoryPath: repo.directory, trustedAt: '2026-10-28T12:00:00.000Z' },
      ]);
      await expect(trust.status(git)).resolves.toMatchObject({ trusted: true });
    },
  );

  test('keeps approvals in memory without a settings file', async ({ expect, repositories }) => {
    const { repo, git } = await openFirstCommit(repositories);
    const trust = createTraceTrust({});
    await trust.grant(git);
    await expect(trust.list()).resolves.toMatchObject([{ repositoryPath: repo.directory }]);
    await expect(trust.remove(repo.directory)).resolves.toStrictEqual([]);
  });

  test(
    'keys the approval by real path and withdraws it when the recorded remote is gone',
    { concurrent: false },
    async ({ expect, clock, repositories, tempDir }) => {
      clock.set('2026-10-28T12:00:00Z');
      const { repo, git } = await openFirstCommit(repositories);
      const settingsPath = path.join(tempDir, 'settings.json');
      await repo.git('remote', 'add', 'origin', 'https://github.com/acme/widgets.git');
      const trust = createTraceTrust({ settingsPath });
      await expect(trust.grant(git)).resolves.toMatchObject({
        trusted: true,
        remoteUrl: 'https://github.com/acme/widgets.git',
      });
      const stored = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
        traceTrustedRepositories: Record<string, unknown>;
      };
      expect(stored.traceTrustedRepositories[repo.directory]).toStrictEqual({
        trustedAt: '2026-10-28T12:00:00.000Z',
        remoteUrl: 'https://github.com/acme/widgets.git',
      });

      await repo.git('remote', 'set-url', 'origin', 'https://github.com/evil/widgets.git');
      await expect(trust.status(git)).resolves.toMatchObject({ trusted: false });
      await repo.git('remote', 'remove', 'origin');
      await expect(trust.status(git)).resolves.toMatchObject({ trusted: false });
    },
  );

  test(
    'keeps approvals in memory without a settings file and ignores malformed entries',
    { concurrent: false },
    async ({ expect, clock, repositories, tempDir }) => {
      clock.set('2026-10-28T12:00:00Z');
      const { repo, git } = await openFirstCommit(repositories);
      const settingsPath = path.join(tempDir, 'settings.json');
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
    },
  );
});

function firstCommitTemplate(): RepositoryTemplate<undefined> {
  return {
    name: 'main-trace-trust: first commit',
    build: async (repo): Promise<undefined> => {
      repo.write('a.txt', 'a\n');
      await repo.commit('first');
    },
  };
}

async function openFirstCommit(
  repositories: TestRepositories,
): Promise<{ readonly repo: TestRepository; readonly git: GitRepository }> {
  const { repo } = await repositories.fromTemplate(firstCommitTemplate());
  return { repo, git: okValueFrom(await openRepository(repo.directory)) };
}
