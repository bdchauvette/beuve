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
  SessionSummary,
} from '../../contract/ipc-contract.ts';
import type { MainServices } from '../main-services.ts';

/** One handler per invoke channel. Each takes the raw, untrusted renderer argument. */
export type IpcHandlers = {
  readonly [C in InvokeChannel]: (
    request: unknown,
  ) => InvokeResponse<C> | Promise<InvokeResponse<C>>;
};

const noRequest = z.undefined();
const openSessionRequest = z.strictObject({ sessionId: z.string().min(1).max(200) });

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
    'session:list': async (request): Promise<IpcResult<readonly SessionSummary[]>> => {
      const parsed = noRequest.safeParse(request);
      return parsed.success ? services.sessions.list() : invalid(parsed.error);
    },
    'session:open': async (request): Promise<IpcResult<SessionSummary>> => {
      const parsed = openSessionRequest.safeParse(request);
      return parsed.success ? services.sessions.open(parsed.data) : invalid(parsed.error);
    },
  };
}

function invalid(error: z.ZodError): Err<IpcError> {
  return err({ code: 'invalid-request', message: z.prettifyError(error) });
}
