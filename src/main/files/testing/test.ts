import type { TestRepository } from '#internal/git/testing/test-repository.ts';
import { systemSessionDeps } from '#internal/session/system-session-deps.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import { test as baseTest } from '../../testing/test.ts';
import { createSessionServices } from '../../sessions/create-session-services.ts';
import { createGitCaches } from '../../sessions/create-git-caches.ts';
import { createFileServices } from '../create-file-services.ts';
import type { FileServices } from '../create-file-services.ts';
import { filesBranchTemplate } from './files-branch-template.ts';

/**
 * `src/main`'s `test` with file services (ADR 0058): `repo` is {@link filesBranchTemplate} (on
 * `feature`), `files` the file services over `db`, and `sessionId` a local session on `feature`.
 */
export const test = baseTest
  .extend('repo', async ({ repositories }): Promise<TestRepository> => {
    const { repo } = await repositories.fromTemplate(filesBranchTemplate());
    return repo;
  })
  .extend('files', ({ db, logger }): FileServices => {
    const context = {
      db,
      logger: logger.logger,
      deps: systemSessionDeps,
      git: { logger: logger.logger },
      caches: createGitCaches(),
    };
    return createFileServices({ context });
  })
  .extend('sessionId', async ({ db, logger, repo }): Promise<string> => {
    const sessions = createSessionServices({ db, logger: logger.logger });
    const created = await sessions.createLocal({
      repoPath: repo.directory,
      baseRef: 'main',
      headRef: 'feature',
    });
    return okValueFrom(created).id;
  });
