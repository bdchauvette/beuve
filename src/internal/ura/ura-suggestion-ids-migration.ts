import type { Migration } from '#sqlite/run-migrations.ts';

/**
 * Suggestions get ids (ADR 0162): a posting names the suggestion it carried by id, not by its
 * position, which an edit removing an earlier suggestion would hand to another one.
 * `ura_item_suggestions` is rebuilt (ADR 0137's order) with `id`, a random version 4 UUID per
 * existing row, unique within its item. `ura_item_postings` is rebuilt with `suggestion_id` in place
 * of `position` (`''` for a note's own text): each suggestion posting takes the id of the
 * suggestion now at its position, and one whose position no suggestion holds any more, which
 * named a suggestion since removed, is dropped.
 */
export const uraSuggestionIdsMigration: Migration = {
  id: 'ura-0006-suggestion-ids',
  up: `
    CREATE TABLE ura_item_suggestions_new (
      item_id TEXT NOT NULL REFERENCES ura_items (id) ON DELETE CASCADE,
      position INTEGER NOT NULL CHECK (position >= 0),
      id TEXT NOT NULL CHECK (length(id) = 36 AND id NOT GLOB '*[^0-9a-f-]*'),
      path TEXT NOT NULL CHECK (path <> ''),
      start_line INTEGER NOT NULL CHECK (start_line >= 1),
      end_line INTEGER NOT NULL CHECK (end_line >= start_line - 1),
      replacement TEXT NOT NULL,
      PRIMARY KEY (item_id, position),
      UNIQUE (item_id, id)
    ) STRICT;

    INSERT INTO ura_item_suggestions_new
      (item_id, position, id, path, start_line, end_line, replacement)
    SELECT item_id, position,
           lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4'
             || substr(lower(hex(randomblob(2))), 2) || '-'
             || substr('89ab', 1 + abs(random() % 4), 1)
             || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
           path, start_line, end_line, replacement
      FROM ura_item_suggestions;

    DROP TABLE ura_item_suggestions;
    ALTER TABLE ura_item_suggestions_new RENAME TO ura_item_suggestions;

    CREATE TABLE ura_item_postings_new (
      item_id TEXT NOT NULL REFERENCES ura_items (id) ON DELETE CASCADE,
      target TEXT NOT NULL CHECK (target IN ('github')),
      piece TEXT NOT NULL CHECK (piece IN ('note', 'suggestion')),
      suggestion_id TEXT NOT NULL,
      session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
      url TEXT NOT NULL CHECK (url GLOB 'http*://*'),
      head_sha TEXT NOT NULL
        CHECK (length(head_sha) IN (40, 64) AND head_sha NOT GLOB '*[^0-9a-f]*'),
      placement TEXT NOT NULL CHECK (placement IN ('comment', 'suggestion-comment', 'body')),
      posted_at TEXT NOT NULL CHECK (posted_at GLOB
        '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
      -- The note's own text names no suggestion and never has a comment of a suggestion's own.
      CHECK (
        (piece = 'note' AND suggestion_id = '' AND placement <> 'suggestion-comment')
        OR (piece = 'suggestion' AND length(suggestion_id) = 36)
      ),
      PRIMARY KEY (item_id, target, piece, suggestion_id)
    ) STRICT;

    INSERT INTO ura_item_postings_new
      (item_id, target, piece, suggestion_id, session_id, url, head_sha, placement, posted_at)
    SELECT item_id, target, 'note', '', session_id, url, head_sha, placement, posted_at
      FROM ura_item_postings
     WHERE piece = 'note';

    INSERT INTO ura_item_postings_new
      (item_id, target, piece, suggestion_id, session_id, url, head_sha, placement, posted_at)
    SELECT postings.item_id, postings.target, 'suggestion', suggestions.id, postings.session_id,
           postings.url, postings.head_sha, postings.placement, postings.posted_at
      FROM ura_item_postings AS postings
      JOIN ura_item_suggestions AS suggestions
        ON suggestions.item_id = postings.item_id AND suggestions.position = postings.position
     WHERE postings.piece = 'suggestion';

    DROP TABLE ura_item_postings;
    ALTER TABLE ura_item_postings_new RENAME TO ura_item_postings;

    CREATE INDEX ura_item_postings_by_session ON ura_item_postings (session_id, posted_at);
  `,
};
