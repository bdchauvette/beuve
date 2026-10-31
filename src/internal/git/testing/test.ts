import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';

import { test as baseTest } from '#testing/test.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import { openRepository } from '../open-repository.ts';
import type { GitRepository } from '../open-repository.ts';
import { createRepositoryTemplates } from './create-repository-templates.ts';
import type { RepositoryTemplates } from './create-repository-templates.ts';
import type { RepositoryTemplate, TestRepository } from './test-repository.ts';

/** Hands out repositories for one test, each in its own directory under the test's `tempDir`. */
export interface TestRepositories {
  /** An empty repository on `main`. */
  readonly create: () => Promise<TestRepository>;
  /** A copy of `template`, built once per worker, and the data its build returned. */
  readonly fromTemplate: <T>(template: RepositoryTemplate<T>) => Promise<{
    readonly repo: TestRepository;
    readonly value: T;
  }>;
}

/**
 * `#testing/test.ts` plus git fixtures (ADR 0058):
 *
 * - `repositoryTemplates` (worker): the template cache behind `repositories`.
 * - `repositories`: {@link TestRepositories}.
 * - `repo`: an empty repository on `main`, from `repositories.create()`.
 * - `repository`: `repo` opened as a {@link GitRepository}.
 */
export const test = baseTest
  .extend('repositoryTemplates', { scope: 'worker' }, ({ tempRoot }): RepositoryTemplates => {
    return createRepositoryTemplates(mkdtempSync(path.join(tempRoot, 'templates-')));
  })
  .extend('repositories', ({ tempDir, repositoryTemplates, signal }): TestRepositories => {
    let count = 0;
    const fromTemplate = async <T>(
      template: RepositoryTemplate<T>,
    ): Promise<{ readonly repo: TestRepository; readonly value: T }> => {
      count += 1;
      const home = path.join(tempDir, `repository-${String(count)}`);
      mkdirSync(home);
      return repositoryTemplates.copy(template, home, signal);
    };
    return {
      create: async (): Promise<TestRepository> => {
        const { repo } = await fromTemplate(emptyRepository);
        return repo;
      },
      fromTemplate,
    };
  })
  .extend('repo', async ({ repositories }): Promise<TestRepository> => repositories.create())
  .extend('repository', async ({ repo, signal }): Promise<GitRepository> => {
    return okValueFrom(await openRepository(repo.directory, { signal }));
  });

const emptyRepository: RepositoryTemplate<undefined> = {
  name: 'empty',
  build: (): undefined => {
    return;
  },
};
