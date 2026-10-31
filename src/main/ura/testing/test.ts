import type { UraItemView } from '#contract/ipc-contract.ts';
import type { TestRepository } from '#internal/git/testing/test-repository.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import { test as baseTest } from '../../testing/test.ts';
import { uraBranchTemplate } from './ura-branch-template.ts';

/** A human note on `src/app.ts` lines `startLine` to `endLine`. */
export interface NoteSpec {
  readonly startLine: number;
  readonly endLine: number;
  readonly title: string;
}

/** Stages a human note on `src/app.ts` of the test session. */
export type StageNote = (note: NoteSpec) => Promise<UraItemView>;

/**
 * `src/main`'s `test` with ura fixtures (ADR 0058): `repo` is {@link uraBranchTemplate}, `changes`
 * records every `ura:changed` session id, `sessionId` is a local session on `feature`, and `note`
 * stages an `issue` note on `src/app.ts`.
 */
export const test = baseTest
  .extend('repo', async ({ repositories }): Promise<TestRepository> => {
    const { repo } = await repositories.fromTemplate(uraBranchTemplate());
    return repo;
  })
  .extend('changes', ({ services }): string[] => {
    const changes: string[] = [];
    services.ura.onChanged((id) => {
      changes.push(id);
    });
    return changes;
  })
  .extend('sessionId', async ({ services, repo }): Promise<string> => {
    const created = await services.sessions.createLocal({
      repoPath: repo.directory,
      baseRef: 'main',
      headRef: 'feature',
    });
    return okValueFrom(created).id;
  })
  .extend('note', ({ services, sessionId }): StageNote => {
    return async ({ startLine, endLine, title }) => {
      return okValueFrom(
        await services.ura.create({
          sessionId,
          anchor: { kind: 'lines', path: 'src/app.ts', startLine, endLine },
          severity: 'issue',
          title,
          body: 'Body',
        }),
      );
    };
  });
