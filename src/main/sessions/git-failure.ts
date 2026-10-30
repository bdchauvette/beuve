import type { IpcError } from '#contract/ipc-contract.ts';
import type { GitError } from '#internal/git/git-error.ts';
import type { Logger } from '#x/log/create-logger.ts';
import { err } from '#x/result/err.ts';
import type { Err } from '#x/result/result.ts';

import { ipcErrorFromGitError } from './ipc-error-from-git-error.ts';

/** Logs a git failure in full and returns the renderer-safe IPC error for it. */
export function gitFailure(logger: Logger, error: GitError): Err<IpcError> {
  logger.warn('git operation failed', { error });
  return err(ipcErrorFromGitError(error));
}
