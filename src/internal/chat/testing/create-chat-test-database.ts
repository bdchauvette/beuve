import type { DatabaseSync } from 'node:sqlite';

import { openDatabase } from '#sqlite/open-database.ts';
import { runMigrations } from '#sqlite/run-migrations.ts';

import { chatMigrations } from '../chat-migrations.ts';

/**
 * An in-memory database with a stub `sessions` table (just the `id` chat messages reference; the
 * session domain can't be imported here, ADR 0002) and the chat migrations applied.
 */
export function createChatTestDatabase(sessionIds: readonly string[]): DatabaseSync {
  const db = openDatabase(':memory:');
  runMigrations(db, [
    { id: 'test-0000-sessions-stub', up: 'CREATE TABLE sessions (id TEXT PRIMARY KEY) STRICT;' },
    ...chatMigrations,
  ]);
  const insert = db.prepare('INSERT INTO sessions (id) VALUES (?);');
  for (const id of sessionIds) {
    insert.run(id);
  }
  return db;
}
