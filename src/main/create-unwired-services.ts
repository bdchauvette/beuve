import { err } from '#pkg/result/err.ts';
import type { Err } from '#pkg/result/result.ts';

import type { IpcError } from '../contract/ipc-contract.ts';

import type { MainServices } from './main-services.ts';

const notWiredResult: Promise<Err<IpcError>> = Promise.resolve(
  err({ code: 'not-wired', message: 'sessions are not wired into the main process yet' }),
);
const notImplementedResult: Promise<Err<string>> = Promise.resolve(
  err('not implemented yet: beuve has not wired this tool to its domains'),
);

/**
 * Services for a shell with no domains composed yet: every call fails honestly with
 * `not-wired` (IPC) or a "not implemented yet" tool error (MCP). Never fakes data.
 */
export function createUnwiredServices(): MainServices {
  return {
    sessions: { list: notWired, open: notWired },
    mcpTools: {
      getLspDiagnostics: notImplemented,
      runImpactCheck: notImplemented,
      runTraceProbe: notImplemented,
      readHumanReview: notImplemented,
    },
  };
}

async function notWired(): Promise<Err<IpcError>> {
  return notWiredResult;
}

async function notImplemented(): Promise<Err<string>> {
  return notImplementedResult;
}
