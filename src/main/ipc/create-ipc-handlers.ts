import { z } from 'zod';

import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Err } from '#pkg/result/result.ts';

import type {
  AppInfo,
  InvokeChannel,
  InvokeResponse,
  IpcError,
  IpcResult,
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
  };
}

function invalid(error: z.ZodError): Err<IpcError> {
  return err({ code: 'invalid-request', message: z.prettifyError(error) });
}
