import type { IpcError } from '#contract/ipc-contract.ts';
import type { Logger } from '#x/log/create-logger.ts';
import { err } from '#x/result/err.ts';
import type { Err } from '#x/result/result.ts';

import { gitFailure } from '../sessions/git-failure.ts';
import type { WorktreeLeaseError } from './create-session-worktrees.ts';

/**
 * The IPC error for a refused worktree lease: `stale-review` when the head moved before the
 * checkout was granted (an expected race, logged at debug level), else the git failure's.
 */
export function worktreeFailure(logger: Logger, error: WorktreeLeaseError): Err<IpcError> {
  if (error.kind !== 'stale-head') {
    return gitFailure(logger, error);
  }
  logger.debug('worktree refused for a stale head', { ...error });
  return err({ code: 'stale-review', message: 'The head moved; showing the new commits.' });
}
