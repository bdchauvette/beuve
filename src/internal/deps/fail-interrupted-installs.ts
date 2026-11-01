import type { DatabaseSync } from 'node:sqlite';

/**
 * Marks installs left `pending` or `running` by a beuve that quit or crashed as `failed`, at
 * startup: nothing runs them any more. Answers how many it changed.
 */
export function failInterruptedInstalls(db: DatabaseSync, updatedAt: string): number {
  const { changes } = db
    .prepare(
      `UPDATE dependency_installs SET state = 'failed', reason = 'interrupted: beuve quit', updated_at = ?
        WHERE state IN ('pending', 'running');`,
    )
    .run(updatedAt);
  return Number(changes);
}
