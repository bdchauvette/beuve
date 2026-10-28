import { z } from 'zod';

import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Err } from '#pkg/result/result.ts';

import { normalizePathPrefix } from '#contract/normalize-path-prefix.ts';
import type {
  AppInfo,
  CallHierarchyRequest,
  CallHierarchyView,
  ImpactView,
  InsightListView,
  InsightStatusChangeView,
  InvokeChannel,
  InvokeResponse,
  IpcError,
  IpcResult,
  ReviewRunHandleView,
  ReviewRunRequest,
  ReviewView,
  SessionSummary,
} from '#contract/ipc-contract.ts';
import type { MainServices } from '../main-services.ts';

/** One handler per invoke channel. Each takes the raw, untrusted renderer argument. */
export type IpcHandlers = {
  readonly [C in InvokeChannel]: (
    request: unknown,
  ) => InvokeResponse<C> | Promise<InvokeResponse<C>>;
};

const noRequest = z.undefined();
const sessionId = z.string().min(1).max(200);
const sessionRequest = z.strictObject({ sessionId });
const revision = z.string().trim().min(1).max(1024);
const localSessionRequest = z.strictObject({
  repoPath: z.string().min(1).max(4096),
  baseRef: revision,
  headRef: revision,
});
const markReviewedRequest = z.strictObject({
  sessionId,
  expectedHeadSha: z
    .string()
    .regex(/^(?:[\da-f]{40}|[\da-f]{64})$/u)
    .optional(),
});

const callHierarchyRequest = z.strictObject({
  sessionId,
  path: z.string().min(1).max(4096),
  line: z.number().int().min(1).max(10_000_000),
  character: z.number().int().min(0).max(10_000_000).optional(),
  direction: z.enum(['incoming', 'outgoing']),
  nodeId: z.string().min(1).max(200).optional(),
});

const pathPrefix = z
  .string()
  .max(4096)
  .transform((raw, context) => {
    const normalized = normalizePathPrefix(raw);
    if (normalized === undefined) {
      context.addIssue({ code: 'custom', message: 'expected a repository-relative path prefix' });
      return z.NEVER;
    }
    return normalized;
  });

const reviewRunRequest = z.strictObject({
  sessionId,
  pathPrefixes: z.array(pathPrefix).max(64).optional(),
  fresh: z.boolean().optional(),
  effort: z.enum(['low', 'medium', 'high']).optional(),
});

const insightStatusRequest = z.strictObject({
  insightId: z.string().regex(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/u),
  status: z.enum(['pending', 'promoted', 'dismissed']),
});

/**
 * Builds the invoke handlers. The renderer is untrusted, so each handler validates its argument
 * before anything reaches `services`, and answers bad input with an `invalid-request` error.
 */
export function createIpcHandlers(services: MainServices, appInfo: AppInfo): IpcHandlers {
  return {
    'app:get-info': (request): IpcResult<AppInfo> => {
      const parsed = noRequest.safeParse(request);
      return parsed.success ? ok(appInfo) : invalid(parsed.error);
    },
    'session:list': (request): IpcResult<readonly SessionSummary[]> => {
      const parsed = noRequest.safeParse(request);
      return parsed.success ? services.sessions.list() : invalid(parsed.error);
    },
    'session:open': (request): IpcResult<SessionSummary> => {
      const parsed = sessionRequest.safeParse(request);
      return parsed.success ? services.sessions.open(parsed.data) : invalid(parsed.error);
    },
    'session:create-local': async (request): Promise<IpcResult<SessionSummary>> => {
      const parsed = localSessionRequest.safeParse(request);
      return parsed.success ? services.sessions.createLocal(parsed.data) : invalid(parsed.error);
    },
    'session:get-review': async (request): Promise<IpcResult<ReviewView>> => {
      const parsed = sessionRequest.safeParse(request);
      return parsed.success ? services.sessions.getReview(parsed.data) : invalid(parsed.error);
    },
    'session:mark-reviewed': async (request): Promise<IpcResult<SessionSummary>> => {
      const parsed = markReviewedRequest.safeParse(request);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      const { sessionId: id, expectedHeadSha } = parsed.data;
      return services.sessions.markReviewed(
        expectedHeadSha === undefined ? { sessionId: id } : { sessionId: id, expectedHeadSha },
      );
    },
    'session:get-impact': async (request): Promise<IpcResult<ImpactView>> => {
      const parsed = sessionRequest.safeParse(request);
      return parsed.success ? services.impact.getImpact(parsed.data) : invalid(parsed.error);
    },
    'lsp:call-hierarchy': async (request): Promise<IpcResult<CallHierarchyView>> => {
      const parsed = callHierarchyRequest.safeParse(request);
      return parsed.success
        ? services.lsp.callHierarchy(withoutUndefined(parsed.data))
        : invalid(parsed.error);
    },
    'review:run': async (request): Promise<IpcResult<ReviewRunHandleView>> => {
      const parsed = reviewRunRequest.safeParse(request);
      return parsed.success
        ? services.review.run(toRunRequest(parsed.data))
        : invalid(parsed.error);
    },
    'review:list-insights': async (request): Promise<IpcResult<InsightListView>> => {
      const parsed = sessionRequest.safeParse(request);
      return parsed.success ? services.review.listInsights(parsed.data) : invalid(parsed.error);
    },
    'review:set-insight-status': (request): IpcResult<InsightStatusChangeView> => {
      const parsed = insightStatusRequest.safeParse(request);
      return parsed.success ? services.review.setInsightStatus(parsed.data) : invalid(parsed.error);
    },
  };
}

function withoutUndefined(request: z.infer<typeof callHierarchyRequest>): CallHierarchyRequest {
  const { character, nodeId, ...required } = request;
  return {
    ...required,
    ...(character !== undefined && { character }),
    ...(nodeId !== undefined && { nodeId }),
  };
}

function toRunRequest(request: z.infer<typeof reviewRunRequest>): ReviewRunRequest {
  const { pathPrefixes, fresh, effort, ...required } = request;
  const prefixes = [...new Set(pathPrefixes)];
  return {
    ...required,
    ...(prefixes.length > 0 && { pathPrefixes: prefixes }),
    ...(fresh === true && { fresh }),
    ...(effort !== undefined && { effort }),
  };
}

function invalid(error: z.ZodError): Err<IpcError> {
  return err({ code: 'invalid-request', message: z.prettifyError(error) });
}
