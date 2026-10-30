import { test as baseTest } from '../../testing/test.ts';
import { createImpactWorker } from '../create-impact-worker.ts';
import type { ImpactRunner } from '../create-impact-worker.ts';

/** Starts an ImpactGate runner; `workerUrl` defaults to the real worker. */
export type CreateRunner = (workerUrl?: URL) => ImpactRunner;

/**
 * `src/main`'s `test` with ImpactGate runners (ADR 0058): `createRunner` starts one (disposed after
 * the test) and `scriptedWorkerUrl` is the scripted worker beside this file.
 */
export const test = baseTest
  .extend('scriptedWorkerUrl', (): URL => new URL('scripted-impact-worker.ts', import.meta.url))
  .extend('createRunner', ({ logger }, { onCleanup }): CreateRunner => {
    const runners: ImpactRunner[] = [];
    onCleanup(() => {
      for (const runner of runners) {
        runner.dispose();
      }
    });
    return (workerUrl): ImpactRunner => {
      const runner = createImpactWorker({
        logger: logger.logger,
        ...(workerUrl !== undefined && { workerUrl }),
      });
      runners.push(runner);
      return runner;
    };
  });
