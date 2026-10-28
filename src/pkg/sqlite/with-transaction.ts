import type { DatabaseSync } from 'node:sqlite';

/**
 * Runs `work` inside a transaction, committing on return and rolling back on throw.
 * Nested calls use savepoints. `work` must be synchronous: node:sqlite is synchronous and
 * an awaited gap would let unrelated statements join the transaction.
 */
export function withTransaction<T>(db: DatabaseSync, work: () => T): T {
  const isNested = db.isTransaction;
  const savepoint = 'beuve_nested';
  db.exec(isNested ? `SAVEPOINT ${savepoint};` : 'BEGIN IMMEDIATE;');

  const rollback = (): void => {
    db.exec(isNested ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint};` : 'ROLLBACK;');
  };

  let result: T;
  try {
    result = work();
  } catch (error: unknown) {
    rollback();
    throw error;
  }
  if (result instanceof Promise) {
    rollback();
    throw new TypeError('withTransaction work must be synchronous; it returned a Promise.');
  }
  db.exec(isNested ? `RELEASE ${savepoint};` : 'COMMIT;');
  return result;
}
