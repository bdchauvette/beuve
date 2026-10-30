import type {
  CallHierarchyRequest,
  CallHierarchyView,
  FileAttributesView,
  GetFileAttributesRequest,
  GetReviewOrderRequest,
  IpcResult,
  ReviewOrderFallbackView,
  ReviewOrderMode,
  ReviewOrderView,
} from '#contract/ipc-contract.ts';
import { classifyReviewFile } from '#internal/session/classify-review-file.ts';
import { orderReviewFiles } from '#internal/session/order-review-files.ts';
import type { DependencyEdge } from '#internal/session/order-review-files.ts';
import type { ParseSyntax } from '#internal/syntax/create-syntax-parser.ts';
import type { ModuleResolver } from '#internal/syntax/create-module-resolver.ts';
import { LruCache } from '#x/collections/lru-cache.ts';
import { ok } from '#x/result/ok.ts';

import type { RequestOptions } from '../request-options.ts';
import { gitFailure } from '../sessions/git-failure.ts';
import { headPathOf } from '../sessions/head-path-of.ts';
import { loadReviewDiff } from '../sessions/load-review-diff.ts';
import type { ReviewDiff } from '../sessions/load-review-diff.ts';
import type { SessionContext } from '../sessions/session-context.ts';

import { buildCallEdges } from './build-call-edges.ts';
import { buildImportEdges } from './build-import-edges.ts';
import { createHeadModuleResolver } from './create-head-module-resolver.ts';
import { fileFactsFrom } from './file-facts-from.ts';
import { isImportSource } from './is-import-source.ts';

/** `session:get-order`: the review's files in reading order (ADR 0065). */
export interface OrderServices {
  readonly getOrder: (
    request: GetReviewOrderRequest,
    options?: RequestOptions,
  ) => Promise<IpcResult<ReviewOrderView>>;
}

export interface OrderServicesOptions {
  readonly context: SessionContext;
  readonly parse: ParseSyntax;
  /** The language server's call hierarchy for the session head (`LspServices.callHierarchy`). */
  readonly callHierarchy: (request: CallHierarchyRequest) => Promise<IpcResult<CallHierarchyView>>;
  /** `linguist-generated` per file (`FileServices.getFileAttributes`). */
  readonly getFileAttributes: (
    request: GetFileAttributesRequest,
    options?: RequestOptions,
  ) => Promise<IpcResult<FileAttributesView>>;
  /** The saved mode, for requests without one. */
  readonly defaultMode: () => Promise<ReviewOrderMode>;
  /** Module resolvers kept, one per (repository, head). Defaults to 4. */
  readonly cacheSize?: number;
}

interface EdgePlan {
  readonly mode: ReviewOrderMode;
  readonly edges: readonly DependencyEdge[];
  readonly fallback?: ReviewOrderFallbackView;
}

/**
 * Computes the order over the plain diff `session:get-review` shows. Every order puts config and
 * mechanical files last (lockfiles, generated, formatting-only and pure-rename files, config
 * patterns). `imports` puts a changed file's changed imports before it; `calls` does the same
 * over the language server's outgoing calls, falling back to `imports` when no server answers,
 * and says so in `fallback`. Either falls back to path order when no changed file is TypeScript
 * or JavaScript.
 */
export function createOrderServices(options: OrderServicesOptions): OrderServices {
  const { context, parse } = options;
  const resolvers = new LruCache<string, ModuleResolver>(options.cacheSize ?? 4);

  const importEdges = async (
    review: ReviewDiff,
    primary: ReadonlySet<string>,
  ): Promise<readonly DependencyEdge[] | undefined> => {
    const { repository, session } = review.refreshed;
    const key = `${repository.root}\0${session.headSha}`;
    let resolver = resolvers.get(key);
    if (resolver === undefined) {
      const created = await createHeadModuleResolver(repository, session.headSha);
      if (!created.ok) {
        gitFailure(context.logger, created.error);
        return undefined;
      }
      resolver = created.value;
      resolvers.set(key, resolver);
    }
    const edges = await buildImportEdges(repository, parse, resolver, review.files, primary);
    if (!edges.ok) {
      gitFailure(context.logger, edges.error);
      return undefined;
    }
    return edges.value;
  };

  const planEdges = async (
    mode: ReviewOrderMode,
    sessionId: string,
    review: ReviewDiff,
    primary: ReadonlySet<string>,
  ): Promise<EdgePlan> => {
    if (mode === 'path') {
      return { mode, edges: [] };
    }
    const hasSource = review.files.some(
      (file) => primary.has(headPathOf(file)) && isImportSource(headPathOf(file)),
    );
    if (!hasSource) {
      return { mode: 'path', edges: [], fallback: { kind: 'no-source-files' } };
    }
    if (mode === 'imports') {
      return { mode, edges: (await importEdges(review, primary)) ?? [] };
    }
    const calls = await buildCallEdges(
      options.callHierarchy,
      sessionId,
      review.refreshed.session.headSha,
      review.files,
      primary,
    );
    if (calls.edges.length > 0) {
      return { mode, edges: calls.edges };
    }
    const fallback: ReviewOrderFallbackView =
      calls.answered === 0 && calls.unsupported > 0
        ? { kind: 'no-language-server' }
        : { kind: 'no-call-edges' };
    return { mode: 'imports', edges: (await importEdges(review, primary)) ?? [], fallback };
  };

  return {
    getOrder: async (request, call = {}): Promise<IpcResult<ReviewOrderView>> => {
      const { signal } = call;
      const requestedMode = request.mode ?? (await options.defaultMode());
      const [diff, ignoring, attributes] = await Promise.all([
        loadReviewDiff(context, request.sessionId, { signal }),
        loadReviewDiff(context, request.sessionId, {
          ignoreWhitespace: true,
          signal,
        }),
        options.getFileAttributes({ sessionId: request.sessionId }, { signal }),
      ]);
      if (!diff.ok) {
        return diff;
      }
      const evidence = {
        generated: new Set(attributes.ok ? attributes.value.generated : []),
        changedIgnoringWhitespace: new Set(
          ignoring.ok ? ignoring.value.files.map((file) => headPathOf(file)) : [],
        ),
      };
      const classified = diff.value.files.map((file) => ({
        path: headPathOf(file),
        mechanical: classifyReviewFile(headPathOf(file), fileFactsFrom(file, evidence)),
      }));
      const primary = new Set(
        classified.filter((file) => file.mechanical === undefined).map((file) => file.path),
      );
      const plan = await planEdges(requestedMode, request.sessionId, diff.value, primary);
      const groups = orderReviewFiles(classified, plan.edges);
      return ok({
        sessionId: request.sessionId,
        headSha: diff.value.refreshed.session.headSha,
        requestedMode,
        mode: plan.mode,
        ...(plan.fallback !== undefined && { fallback: plan.fallback }),
        paths: groups.flatMap((group) => group.paths),
        groups: groups.map((group) => ({
          id: group.id,
          label: group.label,
          paths: group.paths,
          ...(group.reasons !== undefined && { reasons: group.reasons }),
        })),
      });
    },
  };
}
