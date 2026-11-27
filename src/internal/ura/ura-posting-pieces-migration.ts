import type { Migration } from '#sqlite/run-migrations.ts';

/**
 * A posting records one piece of a note (ADR 0162): its text or one of its suggestions, each
 * placed on its own, in the note's comment, a suggestion's own comment or the note's body section.
 * `ura_item_postings` is rebuilt (ADR 0137's order) with `piece` and `position` in its primary key.
 * Each existing row, which carried the whole note, becomes the note's piece (`inline` is now
 * `comment`) plus one row per suggestion the note has, placed where the note went, so a note
 * posted before stays posted.
 */
export const uraPostingPiecesMigration: Migration = {
  id: 'ura-0005-posting-pieces',
  up: `
    CREATE TABLE ura_item_postings_new (
      item_id TEXT NOT NULL REFERENCES ura_items (id) ON DELETE CASCADE,
      target TEXT NOT NULL CHECK (target IN ('github')),
      piece TEXT NOT NULL CHECK (piece IN ('note', 'suggestion')),
      position INTEGER NOT NULL CHECK (position >= 0),
      session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
      url TEXT NOT NULL CHECK (url GLOB 'http*://*'),
      head_sha TEXT NOT NULL
        CHECK (length(head_sha) IN (40, 64) AND head_sha NOT GLOB '*[^0-9a-f]*'),
      placement TEXT NOT NULL CHECK (placement IN ('comment', 'suggestion-comment', 'body')),
      posted_at TEXT NOT NULL CHECK (posted_at GLOB
        '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
      -- The note's own text has position 0 and never has a comment of a suggestion's own.
      CHECK (piece = 'suggestion' OR (position = 0 AND placement <> 'suggestion-comment')),
      PRIMARY KEY (item_id, target, piece, position)
    ) STRICT;

    INSERT INTO ura_item_postings_new
      (item_id, target, piece, position, session_id, url, head_sha, placement, posted_at)
    SELECT item_id, target, 'note', 0, session_id, url, head_sha,
           CASE placement WHEN 'inline' THEN 'comment' ELSE 'body' END, posted_at
      FROM ura_item_postings;

    INSERT INTO ura_item_postings_new
      (item_id, target, piece, position, session_id, url, head_sha, placement, posted_at)
    SELECT postings.item_id, postings.target, 'suggestion', suggestions.position,
           postings.session_id, postings.url, postings.head_sha,
           CASE postings.placement WHEN 'inline' THEN 'comment' ELSE 'body' END,
           postings.posted_at
      FROM ura_item_postings AS postings
      JOIN ura_item_suggestions AS suggestions ON suggestions.item_id = postings.item_id;

    DROP TABLE ura_item_postings;
    ALTER TABLE ura_item_postings_new RENAME TO ura_item_postings;

    CREATE INDEX ura_item_postings_by_session ON ura_item_postings (session_id, posted_at);
  `,
};
