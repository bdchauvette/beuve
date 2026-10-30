import { runMigrations } from '#sqlite/run-migrations.ts';
import { test as baseTest } from '#testing/test.ts';

import { chatMigrations } from '../chat-migrations.ts';

/**
 * `#testing/test.ts` with chat fixtures (ADR 0058): `db` has a stub `sessions` table (just the
 * `id` chat messages reference; the session domain can't be imported here, ADR 0002) holding
 * session `1111…`, plus the chat tables.
 */
export const test = baseTest.extend('db', ({ db }) => {
  runMigrations(db, [
    { id: 'test-0000-sessions-stub', up: 'CREATE TABLE sessions (id TEXT PRIMARY KEY) STRICT;' },
    ...chatMigrations,
  ]);
  const insert = db.prepare('INSERT INTO sessions (id) VALUES (?);');
  insert.run('11111111-1111-4111-8111-111111111111');
  return db;
});
