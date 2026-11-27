import { chatMigrations } from '#internal/chat/chat-migrations.ts';
import { githubMigrations } from '#internal/github/github-migrations.ts';
import { reviewEditsMigrations } from '#internal/review-edits/review-edits-migrations.ts';
import { sessionMigrations } from '#internal/session/session-migrations.ts';
import { sessionReviewRangesMigration } from '#internal/session/session-review-ranges-migration.ts';
import { setupMigrations } from '#internal/setup/setup-migrations.ts';
import { uraFindingConfidenceMigration } from '#internal/ura/ura-finding-confidence-migration.ts';
import { uraMigrations } from '#internal/ura/ura-migrations.ts';
import { uraPostingPiecesMigration } from '#internal/ura/ura-posting-pieces-migration.ts';
import { uraSuggestionIdsMigration } from '#internal/ura/ura-suggestion-ids-migration.ts';
import { uraSuggestionsMigration } from '#internal/ura/ura-suggestions-migration.ts';
import type { Migration } from '#sqlite/run-migrations.ts';

import { retiredMigrations } from './retired-migrations.ts';

/**
 * Every domain's migrations in the fixed order they run (ADR 0006). A domain whose tables
 * reference another's comes after it: `session` first, then `ura` (its items cascade from
 * `sessions`, ADR 0023), then `chat` (its messages cascade from `sessions`, ADR 0031), then
 * `github` (pull request metadata, which references nothing, ADR 0037), then `review-edits`
 * (its rows cascade from `sessions` and `ura_items`, ADR 0088), then `setup` (its runs cascade
 * from `sessions`, ADR 0130), then `retired` (drops of tables whose domains are gone, ADR 0096).
 * Migrations added since then follow, one per file, in the order they were written, so a database
 * that already ran the lists above applies them in the same order a fresh one does (ADR 0006
 * amendment 2026-11-18).
 */
export const appMigrations: readonly Migration[] = Object.freeze([
  ...sessionMigrations,
  ...uraMigrations,
  ...chatMigrations,
  ...githubMigrations,
  ...reviewEditsMigrations,
  ...setupMigrations,
  ...retiredMigrations,
  uraFindingConfidenceMigration,
  sessionReviewRangesMigration,
  uraSuggestionsMigration,
  uraPostingPiecesMigration,
  uraSuggestionIdsMigration,
]);
