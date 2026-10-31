import path from 'node:path';

import type { TraceStatusView } from '#contract/ipc-contract.ts';
import type { TestRepository } from '#internal/git/testing/test-repository.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import type { MainServices } from '../../main-services.ts';
import { test as baseTest } from '../../testing/test.ts';
import { waitUntil } from '../../testing/wait-until.ts';
import { traceBranchTemplate } from './trace-branch-template.ts';

/** The last non-running status the trace published, once there is one. */
export type SettledTrace = () => Promise<TraceStatusView>;

/**
 * `src/main`'s `test` with trace probes over a real Vitest project (ADR 0058): `repo` is
 * {@link traceBranchTemplate}, `traceDirectory` where runs work, `traceEvents` every published
 * status, `services` traces with a 30 s probe budget, `sessionId` is a local session on
 * `feature` and `settledTrace` waits for the final status.
 */
export const test = baseTest
  .extend('repo', async ({ repositories }): Promise<TestRepository> => {
    const { repo } = await repositories.fromTemplate(traceBranchTemplate());
    return repo;
  })
  .extend('traceDirectory', ({ tempDir }): string => path.join(tempDir, 'trace'))
  .extend('traceEvents', (): TraceStatusView[] => {
    return [];
  })
  .extend('services', ({ createServices, traceDirectory, traceEvents }): MainServices => {
    const services = createServices({
      trace: {
        temporaryDirectory: traceDirectory,
        timeout: Temporal.Duration.from({ seconds: 30 }),
      },
    });
    services.trace.onStatus((event) => {
      traceEvents.push(event);
    });
    return services;
  })
  .extend('sessionId', async ({ services, repo }): Promise<string> => {
    const created = await services.sessions.createLocal({
      repoPath: repo.directory,
      baseRef: 'main',
      headRef: 'feature',
    });
    return okValueFrom(created).id;
  })
  .extend('settledTrace', ({ traceEvents }): SettledTrace => {
    return async () => {
      await waitUntil(
        () => {
          return traceEvents.some((event) => event.state !== 'running');
        },
        'the trace to settle',
        {
          timeout: Temporal.Duration.from({ seconds: 45 }),
          interval: Temporal.Duration.from({ milliseconds: 25 }),
        },
      );
      const last = traceEvents.findLast((event) => event.state !== 'running');
      if (last === undefined) {
        throw new Error('no final status');
      }
      return last;
    };
  });
