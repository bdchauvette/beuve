import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { openTestRepository } from './open-test-repository.ts';
import type { NewestGit } from './resolve-newest-git.ts';
import type { TestRepository } from './test-repository.ts';

/** A repository made by the newest git, with the ref backend it chose, and that git. */
export interface NewestGitRepository {
  readonly repo: TestRepository;
  readonly git: NewestGit;
}

/**
 * `git init` by `git` (from `resolveNewestGit`) at `<home>/repo` on `main`, with the ref backend
 * it chose (`--ref-format=reftable` from git 2.45) and the identity `createTestRepository` sets.
 * Every command the repository runs uses that git too.
 */
export async function createNewestGitRepository(
  home: string,
  git: NewestGit,
  signal?: AbortSignal,
): Promise<NewestGitRepository> {
  mkdirSync(path.join(home, 'repo'), { recursive: true });
  const repo = openTestRepository(home, { signal, gitBinary: git.binary });
  await repo.git('init', '--quiet', '--initial-branch=main', ...refFormatArgs(git));
  await repo.git('config', 'user.name', 'Beuve Test');
  await repo.git('config', 'user.email', 'test@beuve.invalid');
  await repo.git('config', 'commit.gpgsign', 'false');
  await repo.git('config', 'tag.gpgsign', 'false');
  return { repo, git };
}

/** Git before 2.45 knows no `--ref-format`; its only backend is `files`. */
function refFormatArgs(git: NewestGit): string[] {
  if (git.refFormat === 'reftable') {
    return ['--ref-format=reftable'];
  }
  return [];
}
