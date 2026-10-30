import { closeSync, openSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

/**
 * Opens (creating if needed) a SQLite database at `location`, or an in-memory one for
 * `':memory:'`, with foreign keys enforced and, for files, write-ahead logging. A new file is
 * created owner-only (0600) before SQLite opens it, and SQLite gives its `-wal` and `-shm` files
 * the database's mode (ADR 0081); an existing file keeps its mode.
 */
export function openDatabase(location: string): DatabaseSync {
  if (location !== ':memory:') {
    closeSync(openSync(location, 'a', 0o600));
  }
  const db = new DatabaseSync(location);
  db.exec('PRAGMA foreign_keys = ON;');
  if (location !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  return db;
}
