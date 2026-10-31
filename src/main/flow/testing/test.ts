import type { FlowGraphView } from '#contract/ipc-contract.ts';
import type { TestRepository } from '#internal/git/testing/test-repository.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import { test as baseTest } from '../../testing/test.ts';
import { flowBranchTemplate } from './flow-branch-template.ts';

/** The graph of `src/flow.ts` around `line`; rejects when there is none. */
export type GraphAt = (line: number) => Promise<FlowGraphView>;

/**
 * `src/main`'s `test` with flow fixtures (ADR 0058): `repo` is {@link flowBranchTemplate},
 * `sessionId` a local session on `feature` and `graphAt` reads a graph of `src/flow.ts`.
 */
export const test = baseTest
  .extend('repo', async ({ repositories }): Promise<TestRepository> => {
    const { repo } = await repositories.fromTemplate(flowBranchTemplate());
    return repo;
  })
  .extend('sessionId', async ({ services, repo }): Promise<string> => {
    const created = await services.sessions.createLocal({
      repoPath: repo.directory,
      baseRef: 'main',
      headRef: 'feature',
    });
    return okValueFrom(created).id;
  })
  .extend('graphAt', ({ services, sessionId }): GraphAt => {
    return async (line) => {
      const response = okValueFrom(
        await services.flow.getGraph({ sessionId, path: 'src/flow.ts', line }),
      );
      if (response.kind !== 'graph') {
        throw new Error(`no graph: ${response.failure}: ${response.message}`);
      }
      return response.graph;
    };
  });
