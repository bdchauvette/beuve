import type { DatabaseSync } from 'node:sqlite';

/** Forgets a checkout's install, as its checkout is made afresh or removed (ADR 0079 amendment). */
export function deleteDependencyInstall(db: DatabaseSync, checkoutPath: string): void {
  db.prepare('DELETE FROM dependency_installs WHERE checkout_path = ?;').run(checkoutPath);
}
