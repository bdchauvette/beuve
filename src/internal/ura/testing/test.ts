import { runMigrations } from '#sqlite/run-migrations.ts';
import { test as baseTest } from '#testing/test.ts';

import type { UraDeps } from '../ura-item.ts';
import { uraMigrations } from '../ura-migrations.ts';
import { fixedUraDeps } from './fixed-ura-deps.ts';
import { testUraIds } from './test-ura-ids.ts';

/**
 * `#testing/test.ts` with URA fixtures (ADR 0058): `db` has a stub `sessions` table (just the `id`
 * that `ura_items` references; the session domain can't be imported here, ADR 0002) holding
 * `testUraIds.sessionId` and `testUraIds.otherSessionId`, plus the URA tables; `deps` is
 * {@link fixedUraDeps}.
 */
export const test = baseTest
  .extend('db', ({ db }) => {
    runMigrations(db, [
      { id: 'test-0000-sessions-stub', up: 'CREATE TABLE sessions (id TEXT PRIMARY KEY) STRICT;' },
      ...uraMigrations,
    ]);
    const insert = db.prepare('INSERT INTO sessions (id) VALUES (?);');
    insert.run(testUraIds.sessionId);
    insert.run(testUraIds.otherSessionId);
    return db;
  })
  .extend('deps', (): UraDeps => fixedUraDeps());
