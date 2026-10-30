import type { IpcError } from '#contract/ipc-contract.ts';
import type { SessionError } from '#internal/session/session.ts';
import type { Logger } from '#x/log/create-logger.ts';
import { err } from '#x/result/err.ts';
import type { Err } from '#x/result/result.ts';

import { ipcErrorFromSessionError } from './ipc-error-from-session-error.ts';

/** Logs a session-domain failure (as an error if it is an internal fault) and maps it for IPC. */
export function sessionFailure(logger: Logger, error: SessionError): Err<IpcError> {
  const mapped = ipcErrorFromSessionError(error);
  if (mapped.code === 'internal') {
    logger.error('session store failed', { error });
  }
  return err(mapped);
}
