import type { GetImpactRequest, IpcError, IpcResult, ImpactView } from '#contract/ipc-contract.ts';
import { untilAborted } from '#x/async/until-aborted.ts';
import { LruCache } from '#x/collections/lru-cache.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { RequestOptions } from '../request-options.ts';
import { gitFailure } from '../sessions/git-failure.ts';
import { loadReviewDiff } from '../sessions/load-review-diff.ts';
import type { ReviewDiff } from '../sessions/load-review-diff.ts';
import type { SessionContext } from '../sessions/session-context.ts';

import { assembleImpactInput } from './assemble-impact-input.ts';
import type { ImpactRunner } from './create-impact-worker.ts';
import { slimImpactView } from './slim-impact-view.ts';
import { impactViewFrom } from './impact-view-from.ts';
import { Stopwatch } from '#x/time/stopwatch.ts';

const cancelled: IpcError = { code: 'cancelled', message: 'cancelled' };

const headMoved: IpcError = {
  code: 'stale-review',
  message: 'ImpactGate was cancelled: the head moved',
};

/** ImpactGate for the renderer and the MCP tool. */
export interface ImpactServices {
  /** The full view: every changed function of every file. For MCP and main-side consumers. */
  readonly getImpact: (
    request: GetImpactRequest,
    options?: RequestOptions,
  ) => Promise<IpcResult<ImpactView>>;
  /** The renderer's view of the same computation, without the function rows it never shows. */
  readonly getImpactForRenderer: (
    request: GetImpactRequest,
    options?: RequestOptions,
  ) => Promise<IpcResult<ImpactView>>;
  /** Cancels the session's in-flight computation if it is for a head other than `headSha`. */
  readonly observeHead: (sessionId: string, headSha: string) => void;
}

export interface ImpactServicesOptions {
  readonly context: SessionContext;
  /** Runs parsing and measuring off the main thread (ADR 0053). */
  readonly runner: ImpactRunner;
  /** Reports kept, one per (session, reviewed range, base, head). Defaults to 32. */
  readonly cacheSize?: number;
}

/**
 * Computes ImpactGate over the same diff `session:get-review` shows, separately from it so parsing
 * never delays the review, and in a worker thread so it never blocks main (ADR 0053). Reports are
 * cached per diff (session, reviewed-from head, base, head); concurrent requests for the same diff
 * share one computation, failures are not cached, and a head change cancels the old computation,
 * including one still loading its diff when the head moved.
 */
export function createImpactServices(options: ImpactServicesOptions): ImpactServices {
  const { context, runner } = options;
  const running = new Map<
    string,
    { readonly headSha: string; readonly abort: AbortController; waiters: number }
  >();
  const cache = new LruCache<string, Promise<Result<ImpactView, IpcError>>>(
    options.cacheSize ?? 32,
  );

  const slimmed = new WeakMap<ImpactView, ImpactView>();
  let observations = 0;
  const lastObserved = new Map<string, { readonly sequence: number; readonly headSha: string }>();

  const compute = async (
    sessionId: string,
    diff: ReviewDiff,
    signal: AbortSignal,
  ): Promise<Result<ImpactView, IpcError>> => {
    const stopwatch = new Stopwatch();
    const input = await assembleImpactInput(diff.refreshed.repository, diff.files);
    if (!input.ok) {
      return gitFailure(context.logger, input.error);
    }
    const run = await runner.run(input.value.sources, signal);
    if (!run.ok) {
      return err(
        run.error.kind === 'cancelled'
          ? headMoved
          : { code: 'internal', message: `ImpactGate failed: ${run.error.message}` },
      );
    }
    const report = run.value;
    const compute = stopwatch.elapsed();
    context.logger.debug('impact computed', {
      sessionId,
      files: diff.files.length,
      parsed: input.value.sources.length,
      compute,
    });
    return ok(
      impactViewFrom({
        sessionId,
        baseSha: diff.baseSha,
        headSha: diff.refreshed.session.headSha,
        report,
        skipped: input.value.skipped,
        order: diff.files.map((file) => ('newPath' in file ? file.newPath : file.path)),
        compute,
      }),
    );
  };

  /**
   * Waits for a shared computation on the caller's signal. The last waiter to give up aborts it
   * and drops it from the cache, since nobody is left to want it (ADR 0079).
   */
  const waitFor = async (
    key: string,
    computing: Promise<Result<ImpactView, IpcError>>,
    signal: AbortSignal | undefined,
  ): Promise<Result<ImpactView, IpcError>> => {
    const job = running.get(key);
    if (job === undefined) {
      return computing;
    }
    job.waiters += 1;
    const outcome = signal === undefined ? await computing : await untilAborted(computing, signal);
    job.waiters -= 1;
    if (outcome !== 'aborted') {
      return outcome;
    }
    if (job.waiters === 0 && running.get(key) === job) {
      job.abort.abort();
      cache.delete(key);
    }
    return err(cancelled);
  };

  const getImpact = async (
    { sessionId }: GetImpactRequest,
    call: RequestOptions = {},
  ): Promise<IpcResult<ImpactView>> => {
    const requestedAt = observations;
    const diff = await loadReviewDiff(context, sessionId, { signal: call.signal });
    if (!diff.ok) {
      return diff;
    }
    const moved = lastObserved.get(sessionId);
    if (
      moved !== undefined &&
      moved.sequence > requestedAt &&
      moved.headSha !== diff.value.refreshed.session.headSha
    ) {
      return err(headMoved);
    }
    const key = cacheKey(sessionId, diff.value);
    const cached = cache.get(key);
    if (cached !== undefined) {
      return waitFor(key, cached, call.signal);
    }
    const abort = new AbortController();
    const headSha = diff.value.refreshed.session.headSha;
    const job = { headSha, abort, waiters: 0 };
    running.set(key, job);
    const computing = compute(sessionId, diff.value, abort.signal);
    void (async (): Promise<void> => {
      const result = await computing;
      if (running.get(key) === job) {
        running.delete(key);
      }
      if (!result.ok && cache.get(key) === computing) {
        cache.delete(key);
      }
    })();
    cache.set(key, computing);
    return waitFor(key, computing, call.signal);
  };

  return {
    getImpact,
    getImpactForRenderer: async (request, call = {}): Promise<IpcResult<ImpactView>> => {
      const full = await getImpact(request, call);
      return full.ok
        ? ok(slimmed.getOrInsertComputed(full.value, () => slimImpactView(full.value)))
        : full;
    },
    observeHead: (sessionId, headSha): void => {
      lastObserved.set(sessionId, { sequence: ++observations, headSha });
      const prefix = `${sessionId}\0`;
      for (const [key, job] of running) {
        if (key.startsWith(prefix) && job.headSha !== headSha) {
          job.abort.abort();
        }
      }
    },
  };
}

function cacheKey(sessionId: string, diff: ReviewDiff): string {
  const from = diff.scope.kind === 'interdiff' ? diff.scope.fromHeadSha : diff.scope.kind;
  return [sessionId, from, diff.baseSha, diff.refreshed.session.headSha].join('\0');
}
