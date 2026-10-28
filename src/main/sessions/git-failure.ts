import type { IpcError } from '#contract/ipc-contract.ts';
import type { GitError } from '#internal/git/git-error.ts';
import type { Logger } from '#pkg/logger/create-logger.ts';
import { err } from '#pkg/result/err.ts';
import type { Err } from '#pkg/result/result.ts';

import { gitErrorToIpcError } from './git-error-to-ipc-error.ts';

/** Logs a git failure in full and returns the renderer-safe IPC error for it. */
export function gitFailure(logger: Logger, error: GitError): Err<IpcError> {
  logger.warn('git operation failed', { error });
  return err(gitErrorToIpcError(error));
}
