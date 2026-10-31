import type { RepositoryTemplate, TestRepository } from '#internal/git/testing/test-repository.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { EditorPlatform } from '../../editor/editor-platform.ts';
import type { MainServices } from '../../main-services.ts';
import { test as baseTest } from '../../testing/test.ts';
import { numberedLines } from './numbered-lines.ts';

/** What the fake editor was asked to open, argv by argv. */
export interface EditorLaunches {
  readonly spawned: (readonly string[])[];
}

/**
 * `src/main`'s `test` for review edits (ADR 0058, 0088): `repo` is {@link reviewEditsTemplate},
 * `launches` records the fake editor's argv, `services` uses that editor, and `sessionId` is a
 * local session reviewing `feature` against `main`.
 */
export const test = baseTest
  .extend('repo', async ({ repositories }): Promise<TestRepository> => {
    const { repo } = await repositories.fromTemplate(reviewEditsTemplate());
    return repo;
  })
  .extend('launches', (): EditorLaunches => {
    return { spawned: [] };
  })
  .extend('services', ({ createServices, launches }): MainServices => {
    const platform: EditorPlatform = {
      platform: 'linux',
      env: { PATH: '/bin', HOME: '/home/me' },
      exists: (file) => {
        return file === '/bin/zed';
      },
      spawn: async (_command, args): Promise<Result<void, string>> => {
        launches.spawned.push(args);
        await Promise.resolve();
        return ok(undefined);
      },
    };
    return createServices({ editor: { platform } });
  })
  .extend('sessionId', async ({ services, repo }): Promise<string> => {
    const created = await services.sessions.createLocal({
      repoPath: repo.directory,
      baseRef: 'main',
      headRef: 'feature',
    });
    return okValueFrom(created).id;
  });

/**
 * `main` with `src/a.ts` (ten numbered lines) and `src/b.ts`; `feature` changes lines 3 and 4 of
 * `a.ts`. Leaves `main` checked out, so the reviewer's own tree is not at the reviewed head.
 */
function reviewEditsTemplate(): RepositoryTemplate<undefined> {
  return {
    name: 'main-review-edits: feature changes two lines',
    build: async (repo): Promise<undefined> => {
      repo.write('src/a.ts', numberedLines());
      repo.write('src/b.ts', 'export const b = 1;\n');
      await repo.commit('base');
      await repo.git('switch', '--quiet', '--create', 'feature');
      repo.write('src/a.ts', numberedLines({ 3: 'three', 4: 'four' }));
      await repo.commit('feature');
      await repo.git('switch', '--quiet', 'main');
    },
  };
}
