import type { DatabaseSync } from 'node:sqlite';

interface TransactionStatements {
  readonly begin: string;
  readonly rollback: string;
  readonly commit: string;
}

const savepoint = 'beuve_nested';
const outermostStatements: TransactionStatements = {
  begin: 'BEGIN IMMEDIATE;',
  rollback: 'ROLLBACK;',
  commit: 'COMMIT;',
};
const nestedStatements: TransactionStatements = {
  begin: `SAVEPOINT ${savepoint};`,
  rollback: `ROLLBACK TO ${savepoint}; RELEASE ${savepoint};`,
  commit: `RELEASE ${savepoint};`,
};

/**
 * Runs `work` inside a transaction, committing on return and rolling back on throw.
 * Nested calls use savepoints. `work` must be synchronous: node:sqlite is synchronous and
 * an awaited gap would let unrelated statements join the transaction.
 */
export function withTransaction<T>(db: DatabaseSync, work: () => T): T {
  const statements = transactionStatements(db.isTransaction);
  db.exec(statements.begin);

  const rollback = (): void => {
    db.exec(statements.rollback);
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
  db.exec(statements.commit);
  return result;
}

/** A savepoint inside a transaction that is already open, else a transaction of its own. */
function transactionStatements(isNested: boolean): TransactionStatements {
  if (isNested) {
    return nestedStatements;
  }
  return outermostStatements;
}
