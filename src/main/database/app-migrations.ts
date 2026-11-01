import { chatMigrations } from '#internal/chat/chat-migrations.ts';
import { githubMigrations } from '#internal/github/github-migrations.ts';
import { reviewEditsMigrations } from '#internal/review-edits/review-edits-migrations.ts';
import { trustMigrations } from '#internal/trust/trust-migrations.ts';
import { sessionMigrations } from '#internal/session/session-migrations.ts';
import { uraMigrations } from '#internal/ura/ura-migrations.ts';
import type { Migration } from '#sqlite/run-migrations.ts';

/**
 * Every domain's migrations in the fixed order they run (ADR 0006). A domain whose tables
 * reference another's comes after it: `session` first, then `ura` (its items cascade from
 * `sessions`, ADR 0023), then `chat` (its messages cascade from `sessions`, ADR 0031), then
 * `github` (pull request metadata, which references nothing, ADR 0037), then `review-edits`
 * (its rows cascade from `sessions` and `ura_items`, ADR 0088), then `trust` (grants, which
 * reference nothing, ADR 0090).
 */
export const appMigrations: readonly Migration[] = Object.freeze([
  ...sessionMigrations,
  ...uraMigrations,
  ...chatMigrations,
  ...githubMigrations,
  ...reviewEditsMigrations,
  ...trustMigrations,
]);
