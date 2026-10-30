import { Worker } from 'node:worker_threads';

import { errorFrom } from '#x/error/error-from.ts';
import type { ImpactSourceFile } from '#internal/impact/impact-input.ts';
import type { ImpactReport } from '#internal/impact/impact-report.ts';
import type { Logger } from '#x/log/create-logger.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type {
  ImpactWorkerData,
  ImpactWorkerRequest,
  ImpactWorkerResponse,
} from './impact-worker-protocol.ts';

/** Why a run produced no report: it was cancelled, or the worker failed or crashed. */
export type ImpactRunFailure =
  { readonly kind: 'cancelled' } | { readonly kind: 'worker-failed'; readonly message: string };

/** Runs ImpactGate off the main thread. Runs are queued and executed one at a time. */
export interface ImpactRunner {
  /** Aborting `signal` cancels a queued run, or terminates the worker mid-run. */
  readonly run: (
    sources: readonly ImpactSourceFile[],
    signal?: AbortSignal,
  ) => Promise<Result<ImpactReport, ImpactRunFailure>>;
  /** Terminates the worker and fails every pending run as cancelled. */
  readonly dispose: () => void;
}

export interface ImpactWorkerOptions {
  readonly logger: Logger;
  /** The worker script. Defaults to the TypeScript source beside this file (tests, `node`). */
  readonly workerUrl?: URL | string | undefined;
  readonly wasmDirectory?: string | undefined;
  readonly maxSourceLength?: number | undefined;
}

interface Job {
  readonly id: number;
  readonly sources: readonly ImpactSourceFile[];
  readonly settle: (result: Result<ImpactReport, ImpactRunFailure>) => void;
  /** Released when the job settles: its listener on the caller's signal. */
  readonly resources: DisposableStack;
}

const cancelled = err<ImpactRunFailure>({ kind: 'cancelled' });

/**
 * One long-lived worker thread running {@link ImpactRunner} (ADR 0053). It starts on the first run,
 * is replaced after a crash or a cancellation, and never keeps the process alive.
 */
export function createImpactWorker(options: ImpactWorkerOptions): ImpactRunner {
  const { logger } = options;
  const workerUrl = options.workerUrl ?? new URL('impact-worker.ts', import.meta.url);
  const queue: Job[] = [];
  let worker: Worker | undefined;
  let current: Job | undefined;
  let nextId = 1;
  let isDisposed = false;

  const spawn = (): Worker => {
    const data: ImpactWorkerData = {
      wasmDirectory: options.wasmDirectory,
      maxSourceLength: options.maxSourceLength,
    };
    const created = new Worker(workerUrl, { workerData: data });
    created.unref();
    created.on('message', (response: ImpactWorkerResponse) => {
      if (created === worker && current?.id === response.id) {
        finish(
          current,
          response.ok
            ? ok(response.report)
            : err({ kind: 'worker-failed', message: response.message }),
        );
      }
    });
    created.on('error', (error: Error) => {
      fail(created, `impact worker crashed: ${error.message}`);
    });
    created.on('exit', (code) => {
      fail(created, `impact worker exited with code ${String(code)}`);
    });
    return created;
  };

  const pump = (): void => {
    if (current !== undefined || isDisposed) {
      return;
    }
    const job = queue.shift();
    if (job === undefined) {
      return;
    }
    current = job;
    worker ??= spawn();
    const request: ImpactWorkerRequest = { id: job.id, sources: job.sources };
    try {
      worker.postMessage(request);
    } catch (error: unknown) {
      finish(job, err({ kind: 'worker-failed', message: errorFrom(error).message }));
    }
  };

  const finish = (job: Job, result: Result<ImpactReport, ImpactRunFailure>): void => {
    job.resources.dispose();
    job.settle(result);
    if (current !== job) {
      return;
    }
    current = undefined;
    pump();
  };

  const retire = (): void => {
    const retired = worker;
    worker = undefined;
    void retired?.terminate();
  };

  const fail = (failed: Worker, message: string): void => {
    if (failed !== worker) {
      return;
    }
    logger.warn(message);
    retire();
    if (current === undefined) {
      return;
    }
    finish(current, err({ kind: 'worker-failed', message }));
  };

  const cancel = (job: Job): void => {
    const queued = queue.indexOf(job);
    if (queued !== -1) {
      queue.splice(queued, 1);
    } else if (current === job) {
      retire();
    } else {
      return;
    }
    finish(job, cancelled);
  };

  return {
    run: async (sources, signal) =>
      new Promise((resolve) => {
        if (isDisposed || signal?.aborted === true) {
          resolve(cancelled);
          return;
        }
        const resources = new DisposableStack();
        const job: Job = { id: nextId++, sources, settle: resolve, resources };
        const listeners = resources.adopt(new AbortController(), (controller) => {
          controller.abort();
        });
        signal?.addEventListener(
          'abort',
          () => {
            cancel(job);
          },
          { once: true, signal: listeners.signal },
        );
        queue.push(job);
        pump();
      }),
    dispose: (): void => {
      isDisposed = true;
      retire();
      const pending = [...queue.splice(0), ...(current === undefined ? [] : [current])];
      current = undefined;
      for (const job of pending) {
        job.resources.dispose();
        job.settle(cancelled);
      }
    },
  };
}
