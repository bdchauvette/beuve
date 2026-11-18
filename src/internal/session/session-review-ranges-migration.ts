import type { Migration } from '#sqlite/run-migrations.ts';

/**
 * Keeps the range a session's review shows, when the reviewer chose one (ADR 0141); no row is the
 * default (since the last checkpoint). Undoing a checkpoint deletes a choice that names it. It is a
 * migration of its own, appended after every domain's earlier ones (ADR 0006 amendment
 * 2026-11-18), so every database applies the same sequence.
 */
export const sessionReviewRangesMigration: Migration = {
  id: 'session-0002-review-ranges',
  up: `
      CREATE TABLE review_ranges (
        session_id TEXT PRIMARY KEY REFERENCES sessions (id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('whole', 'since-checkpoint')),
        checkpoint_id TEXT REFERENCES checkpoints (id) ON DELETE CASCADE,
        CHECK ((kind = 'since-checkpoint') = (checkpoint_id IS NOT NULL))
      ) STRICT;

      CREATE INDEX review_ranges_by_checkpoint ON review_ranges (checkpoint_id);
    `,
};
