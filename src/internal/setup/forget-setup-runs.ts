import type { DatabaseSync } from 'node:sqlite';

/**
 * Forgets every setup that ran in `checkout`, which was just checked out afresh or removed: what
 * the setup wrote there is gone, so it is offered again.
 */
export function forgetSetupRuns(db: DatabaseSync, checkout: string): void {
  db.prepare('DELETE FROM setup_runs WHERE checkout = ?;').run(checkout);
}
