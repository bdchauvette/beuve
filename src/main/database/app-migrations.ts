import { sessionMigrations } from '#internal/session/session-migrations.ts';
import type { Migration } from '#pkg/sqlite/run-migrations.ts';

/**
 * Every domain's migrations in the fixed order they run (ADR 0006). A domain whose tables
 * reference another's comes after it, so `session` is first.
 */
export const appMigrations: readonly Migration[] = Object.freeze([...sessionMigrations]);
