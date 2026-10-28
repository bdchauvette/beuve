import { reviewMigrations } from '#internal/review/review-migrations.ts';
import { sessionMigrations } from '#internal/session/session-migrations.ts';
import { uraMigrations } from '#internal/ura/ura-migrations.ts';
import type { Migration } from '#pkg/sqlite/run-migrations.ts';

/**
 * Every domain's migrations in the fixed order they run (ADR 0006). A domain whose tables
 * reference another's comes after it: `session` first, then `review` (its runs and insights
 * cascade from `sessions`, ADR 0019), then `ura` (its items cascade from `sessions`, ADR 0023).
 */
export const appMigrations: readonly Migration[] = Object.freeze([
  ...sessionMigrations,
  ...reviewMigrations,
  ...uraMigrations,
]);
