import type { DatabaseSync } from 'node:sqlite';

import type { Err, Result } from '#x/result/result.ts';

import { withTransaction } from './with-transaction.ts';

/** Carries a failed result out of {@link withTransaction}, which rolls back on a throw. */
class RolledBack extends Error {
  readonly failure: Err<unknown>;

  constructor(failure: Err<unknown>) {
    super('the transaction’s work failed');
    this.failure = failure;
  }
}

/**
 * Runs `work` inside a transaction (see {@link withTransaction}) that commits when it returns a
 * success and rolls back when it returns a failure, which is returned as it is. A throw rolls back
 * and propagates. `work` must be synchronous.
 */
export function withResultTransaction<T, E>(
  db: DatabaseSync,
  work: () => Result<T, E>,
): Result<T, E> {
  try {
    return withTransaction(db, () => {
      const result = work();
      if (!result.ok) {
        throw new RolledBack(result);
      }
      return result;
    });
  } catch (error: unknown) {
    if (error instanceof RolledBack) {
      return error.failure as Err<E>;
    }
    throw error;
  }
}
