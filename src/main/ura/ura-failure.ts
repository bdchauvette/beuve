import type { IpcError } from '#contract/ipc-contract.ts';
import type { UraArtifactError } from '#internal/ura/ura-artifact.ts';
import type { UraItemError, UraStoreError } from '#internal/ura/ura-item.ts';
import type { Logger } from '#pkg/logger/create-logger.ts';
import { err } from '#pkg/result/err.ts';
import type { Err } from '#pkg/result/result.ts';

/**
 * Maps a URA domain failure to an IPC error the reviewer can act on: invalid input is
 * `invalid-request`, a request the state forbids is `refused`, missing rows are `not-found`, and
 * corrupt rows are logged as internal faults.
 */
export function uraFailure(
  logger: Logger,
  error: UraItemError | UraStoreError | UraArtifactError,
): Err<IpcError> {
  switch (error.kind) {
    case 'invalid-anchor':
    case 'invalid-origin':
    case 'invalid-text':
    case 'invalid-patch': {
      return err({ code: 'invalid-request', message: error.reason });
    }
    case 'invalid-transition': {
      return err({ code: 'refused', message: error.reason });
    }
    case 'session-not-found': {
      return err({ code: 'not-found', message: 'no such session' });
    }
    case 'item-not-found': {
      return err({ code: 'not-found', message: 'no such review item' });
    }
    case 'order-mismatch': {
      return err({
        code: 'refused',
        message: 'the dock is out of date: the order must name every item once',
      });
    }
    case 'approve-with-blockers': {
      const count = error.itemIds.length;
      return err({
        code: 'refused',
        message: `Approving is refused while ${String(count)} ${count === 1 ? 'blocker is' : 'blockers are'} staged.`,
      });
    }
    case 'duplicate-item':
    case 'foreign-item':
    case 'corrupt-row': {
      logger.error('ura store failed', { error });
      return err({ code: 'internal', message: 'stored review items are corrupt' });
    }
  }
}
