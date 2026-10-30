import { DatabaseSync } from 'node:sqlite';

/**
 * Opens (creating if needed) a SQLite database at `location`, or an in-memory one for
 * `':memory:'`, with foreign keys enforced and, for files, write-ahead logging.
 */
export function openDatabase(location: string): DatabaseSync {
  const db = new DatabaseSync(location);
  db.exec('PRAGMA foreign_keys = ON;');
  if (location !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  return db;
}
