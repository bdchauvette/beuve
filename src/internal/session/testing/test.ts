import { runMigrations } from '#sqlite/run-migrations.ts';
import { test as baseTest } from '#testing/test.ts';

import type { SessionDeps } from '../session.ts';
import { sessionMigrations } from '../session-migrations.ts';
import { countingSessionDeps } from './counting-session-deps.ts';

/**
 * `#testing/test.ts` with session fixtures (ADR 0058): `db` has the session tables, and `deps`
 * is {@link countingSessionDeps}.
 */
export const test = baseTest
  .extend('db', ({ db }) => {
    runMigrations(db, sessionMigrations);
    return db;
  })
  .extend('deps', (): SessionDeps => countingSessionDeps());
