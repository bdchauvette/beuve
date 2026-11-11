import { closeSync, openSync, rmSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

/**
 * Writes a consistent copy of `db` to `file` with `VACUUM INTO`, outside any transaction. `file`
 * must not exist: it is created empty and owner-only (0600) first, because `VACUUM INTO` writes
 * into an empty file but would create a missing one with the default mode (ADR 0082). If the copy
 * fails, the file is removed and the error rethrown.
 */
export function backupDatabase(db: DatabaseSync, file: string): void {
  using pending = new DisposableStack();
  closeSync(openSync(file, 'wx', 0o600));
  pending.defer(() => {
    rmSync(file, { force: true });
  });
  db.prepare('VACUUM INTO ?;').run(file);
  pending.move();
}
