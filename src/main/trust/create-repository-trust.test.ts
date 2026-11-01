import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe } from 'vitest';

import { openRepository } from '#internal/git/open-repository.ts';
import type { GitRepository } from '#internal/git/open-repository.ts';
import type { RepositoryTemplate, TestRepository } from '#internal/git/testing/test-repository.ts';
import type { TestRepositories } from '#internal/git/testing/test.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import { test } from '../testing/test.ts';
import { createRepositoryTrust } from './create-repository-trust.ts';

describe('createRepositoryTrust (ADR 0090)', () => {
  test(
    'trusts nothing by default, keeps one grant per repository in the database and revokes it',
    { concurrent: false },
    async ({ expect, clock, repositories, db, logger }) => {
      clock.set('2026-10-28T12:00:00Z');
      const { repo, git } = await openFirstCommit(repositories);
      const trust = createRepositoryTrust({ db, logger: logger.logger });
      await expect(trust.status(git)).resolves.toStrictEqual({
        trusted: false,
        repositoryPath: repo.directory,
      });
      await expect(trust.grant(git)).resolves.toStrictEqual({
        trusted: true,
        repositoryPath: repo.directory,
      });
      await expect(
        createRepositoryTrust({ db, logger: logger.logger }).status(git),
      ).resolves.toMatchObject({ trusted: true });
      await expect(trust.list()).resolves.toStrictEqual([
        { repositoryPath: repo.directory, trustedAt: '2026-10-28T12:00:00.000Z' },
      ]);
      expect(
        db
          .prepare('SELECT kind, scope_key FROM trust_grants;')
          .all()
          .map((row) => {
            return { ...row };
          }),
      ).toStrictEqual([{ kind: 'repository', scope_key: repo.directory }]);
      await expect(trust.revoke(git)).resolves.toMatchObject({ trusted: false });
      await expect(trust.list()).resolves.toStrictEqual([]);
    },
  );

  test(
    'keys the grant by real path and withdraws it when the recorded remote is gone',
    { concurrent: false },
    async ({ expect, clock, repositories, db, logger }) => {
      clock.set('2026-10-28T12:00:00Z');
      const { repo, git } = await openFirstCommit(repositories);
      await repo.git('remote', 'add', 'origin', 'https://github.com/acme/widgets.git');
      const trust = createRepositoryTrust({ db, logger: logger.logger });
      await expect(trust.grant(git)).resolves.toMatchObject({
        trusted: true,
        remoteUrl: 'https://github.com/acme/widgets.git',
      });
      await repo.git('remote', 'set-url', 'origin', 'https://github.com/evil/widgets.git');
      await expect(trust.status(git)).resolves.toMatchObject({ trusted: false });
      await repo.git('remote', 'remove', 'origin');
      await expect(trust.status(git)).resolves.toMatchObject({ trusted: false });
    },
  );

  test('moves the grants an earlier version kept in settings.json, once', async ({
    expect,
    repositories,
    db,
    logger,
    tempDir,
  }) => {
    const { repo, git } = await openFirstCommit(repositories);
    const settingsPath = path.join(tempDir, 'settings.json');
    const gone = path.join(tempDir, 'moved-away');
    writeFileSync(
      settingsPath,
      JSON.stringify({
        preferredEditor: 'zed',
        traceTrustedRepositories: {
          [repo.directory]: { trustedAt: '2026-10-01T09:00:00.000Z' },
          [gone]: { trustedAt: '2026-10-02T09:00:00.000Z', remoteUrl: 'git@x:y' },
          bad: 3,
        },
      }),
    );
    const trust = createRepositoryTrust({
      db,
      logger: logger.logger,
      legacySettingsPath: settingsPath,
    });
    await expect(trust.status(git)).resolves.toMatchObject({ trusted: true });
    await expect(trust.remove(gone)).resolves.toStrictEqual([
      { repositoryPath: repo.directory, trustedAt: '2026-10-01T09:00:00.000Z' },
    ]);
    expect(JSON.parse(readFileSync(settingsPath, 'utf8'))).toStrictEqual({
      preferredEditor: 'zed',
    });
  });
});

function firstCommitTemplate(): RepositoryTemplate<undefined> {
  return {
    name: 'main-repository-trust: first commit',
    build: async (repo): Promise<undefined> => {
      repo.write('a.txt', 'a\n');
      await repo.commit('first');
    },
  };
}

async function openFirstCommit(repositories: TestRepositories): Promise<OpenedCommit> {
  const { repo } = await repositories.fromTemplate(firstCommitTemplate());
  return { repo, git: okValueFrom(await openRepository(repo.directory)) };
}

/** A test repository, and the same repository opened as beuve opens one. */
interface OpenedCommit {
  readonly repo: TestRepository;
  readonly git: GitRepository;
}
