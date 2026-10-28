import type { GetImpactRequest, IpcError, IpcResult, ImpactView } from '#contract/ipc-contract.ts';
import { runImpactCheck } from '#internal/impact/run-impact-check.ts';
import type { ParseSource } from '#internal/impact/impact-input.ts';
import { LruCache } from '#pkg/datastructures/lru-cache.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

import { gitFailure } from '../sessions/git-failure.ts';
import { loadReviewDiff } from '../sessions/load-review-diff.ts';
import type { ReviewDiff } from '../sessions/load-review-diff.ts';
import type { SessionContext } from '../sessions/session-context.ts';

import { assembleImpactInput } from './assemble-impact-input.ts';
import { toImpactView } from './to-impact-view.ts';

/** ImpactGate for the renderer and the MCP tool. */
export interface ImpactServices {
  readonly getImpact: (request: GetImpactRequest) => Promise<IpcResult<ImpactView>>;
}

export interface ImpactServicesOptions {
  readonly context: SessionContext;
  /** The syntax domain's `SyntaxParser.parse`. */
  readonly parse: ParseSource;
  /** Reports kept, one per (session, reviewed range, base, head). Defaults to 32. */
  readonly cacheSize?: number;
}

/**
 * Computes ImpactGate over the same diff `session:get-review` shows, separately from it so parsing
 * never delays the review. Reports are cached per diff (session, reviewed-from head, base, head);
 * concurrent requests for the same diff share one computation, and failures are not cached.
 */
export function createImpactServices(options: ImpactServicesOptions): ImpactServices {
  const { context, parse } = options;
  const cache = new LruCache<string, Promise<Result<ImpactView, IpcError>>>(
    options.cacheSize ?? 32,
  );

  const compute = async (
    sessionId: string,
    diff: ReviewDiff,
  ): Promise<Result<ImpactView, IpcError>> => {
    const started = performance.now();
    const input = await assembleImpactInput(diff.refreshed.repository, diff.files);
    if (!input.ok) {
      return gitFailure(context.logger, input.error);
    }
    const report = await runImpactCheck(input.value.sources, parse);
    const computeMs = Math.round(performance.now() - started);
    context.logger.debug('impact computed', {
      sessionId,
      files: diff.files.length,
      parsed: input.value.sources.length,
      computeMs,
    });
    return ok(
      toImpactView({
        sessionId,
        baseSha: diff.baseSha,
        headSha: diff.refreshed.session.headSha,
        report,
        skipped: input.value.skipped,
        order: diff.files.map((file) => ('newPath' in file ? file.newPath : file.path)),
        computeMs,
      }),
    );
  };

  return {
    getImpact: async ({ sessionId }): Promise<IpcResult<ImpactView>> => {
      const diff = await loadReviewDiff(context, sessionId);
      if (!diff.ok) {
        return diff;
      }
      const key = cacheKey(sessionId, diff.value);
      const cached = cache.get(key);
      if (cached !== undefined) {
        return cached;
      }
      const computing = compute(sessionId, diff.value);
      cache.set(key, computing);
      const result = await computing;
      if (!result.ok) {
        cache.delete(key);
      }
      return result;
    },
  };
}

function cacheKey(sessionId: string, diff: ReviewDiff): string {
  const from = diff.scope.kind === 'interdiff' ? diff.scope.fromHeadSha : diff.scope.kind;
  return [sessionId, from, diff.baseSha, diff.refreshed.session.headSha].join('\0');
}
