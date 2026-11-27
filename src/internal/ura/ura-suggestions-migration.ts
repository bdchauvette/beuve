import type { DatabaseSync } from 'node:sqlite';

import type { Migration } from '#sqlite/run-migrations.ts';

import { parseSuggestedPatch } from './parse-suggested-patch.ts';
import type { UraSuggestion } from './ura-item.ts';
import { uraSuggestionsFromPatch } from './ura-suggestions-from-patch.ts';

/**
 * A note's suggestions become rows of their own (ADR 0162): `ura_item_suggestions` holds each
 * one's path, lines on the item's head and replacement, in order. Every stored `patch` is converted
 * (`uraSuggestionsFromPatch`: each hunk one suggestion over its old range). `ura_items` is then
 * rebuilt without `patch` (ADR 0137's order, foreign keys off): its CHECK that a note has a title,
 * a body or a patch can't see the new table, and a CHECK can only change by a rebuild. A note with
 * only suggestions is the domain's to allow. The table's text is written out here, the severity
 * list included, so later changes to the domain never change what this migration builds.
 */
export const uraSuggestionsMigration: Migration = {
  id: 'ura-0004-suggestions',
  up: migrateToSuggestions,
};

/** One converted suggestion and the item and position it belongs to. */
interface SuggestionRow {
  readonly itemId: string;
  readonly position: number;
  readonly suggestion: UraSuggestion;
}

const columns = [
  'id',
  'session_id',
  'position',
  'head_sha',
  'anchor_kind',
  'path',
  'line_start',
  'line_end',
  'severity',
  'blocking',
  'origin_kind',
  'chat_message_id',
  'chat_finding',
  'chat_proposal',
  'chat_confidence',
  'title',
  'body',
  'status',
  'addressed_sha',
  'addressed_by',
  'created_at',
  'updated_at',
].join(', ');

const rebuild = `
  CREATE TABLE ura_items_new (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    head_sha TEXT NOT NULL CHECK (${sha('head_sha')}),
    anchor_kind TEXT NOT NULL CHECK (anchor_kind IN ('lines', 'file', 'change')),
    path TEXT,
    line_start INTEGER,
    line_end INTEGER,
    severity TEXT NOT NULL CHECK (severity IN ('issue', 'suggestion', 'question', 'nitpick',
      'thought', 'smell', 'praise', 'note', 'todo', 'chore')),
    blocking INTEGER NOT NULL CHECK (blocking IN (0, 1)),
    origin_kind TEXT NOT NULL CHECK (origin_kind IN ('human', 'chat-answer')),
    chat_message_id TEXT,
    chat_finding INTEGER CHECK (chat_finding IS NULL OR chat_finding >= 0),
    chat_proposal INTEGER CHECK (chat_proposal IS NULL OR chat_proposal >= 0),
    chat_confidence REAL
      CHECK (chat_confidence IS NULL
        OR (chat_finding IS NOT NULL AND chat_confidence >= 0 AND chat_confidence <= 1)),
    title TEXT NOT NULL CHECK (title = trim(title) AND length(title) <= 200),
    body TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('staged', 'withdrawn', 'addressed')),
    addressed_sha TEXT CHECK (addressed_sha IS NULL OR ${sha('addressed_sha')}),
    addressed_by TEXT CHECK (addressed_by IS NULL OR addressed_by IN ('reviewer', 'agent')),
    created_at TEXT NOT NULL CHECK (${timestamp('created_at')}),
    updated_at TEXT NOT NULL CHECK (${timestamp('updated_at')}),
    -- Every branch tests IS NOT NULL first: a NULL comparison would make a CHECK pass.
    CHECK (
      (anchor_kind = 'lines' AND path IS NOT NULL AND path <> ''
        AND line_start IS NOT NULL AND line_end IS NOT NULL
        AND line_start >= 1 AND line_end >= line_start)
      OR (anchor_kind = 'file' AND path IS NOT NULL AND path <> ''
        AND line_start IS NULL AND line_end IS NULL)
      OR (anchor_kind = 'change' AND path IS NULL AND line_start IS NULL AND line_end IS NULL)
    ),
    CHECK (
      (origin_kind = 'human' AND chat_message_id IS NULL AND chat_finding IS NULL
        AND chat_proposal IS NULL)
      OR (origin_kind = 'chat-answer' AND chat_message_id IS NOT NULL
        AND trim(chat_message_id) <> ''
        AND (chat_finding IS NULL) <> (chat_proposal IS NULL)
        AND anchor_kind = 'lines')
    ),
    CHECK (
      (status = 'addressed') = (addressed_sha IS NOT NULL)
      AND (status = 'addressed') = (addressed_by IS NOT NULL)
      AND (addressed_sha IS NULL OR addressed_sha <> head_sha)
    )
  ) STRICT;

  INSERT INTO ura_items_new (${columns}) SELECT ${columns} FROM ura_items;
  DROP TABLE ura_items;
  ALTER TABLE ura_items_new RENAME TO ura_items;

  CREATE INDEX ura_items_by_session ON ura_items (session_id, position);
  CREATE UNIQUE INDEX ura_items_by_chat_finding ON ura_items (chat_message_id, chat_finding)
    WHERE chat_finding IS NOT NULL;
  CREATE UNIQUE INDEX ura_items_by_chat_proposal ON ura_items (chat_message_id, chat_proposal)
    WHERE chat_proposal IS NOT NULL;

  -- ADR 0162: a note's suggestions, in order, on the head side of its item's head_sha. An
  -- insertion before start_line has end_line = start_line - 1.
  CREATE TABLE ura_item_suggestions (
    item_id TEXT NOT NULL REFERENCES ura_items (id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    path TEXT NOT NULL CHECK (path <> ''),
    start_line INTEGER NOT NULL CHECK (start_line >= 1),
    end_line INTEGER NOT NULL CHECK (end_line >= start_line - 1),
    replacement TEXT NOT NULL,
    PRIMARY KEY (item_id, position)
  ) STRICT;
`;

function migrateToSuggestions(db: DatabaseSync): void {
  const converted = convertedSuggestions(db);
  db.exec(rebuild);
  const insert = db.prepare(
    `INSERT INTO ura_item_suggestions (item_id, position, path, start_line, end_line, replacement)
     VALUES (?, ?, ?, ?, ?, ?);`,
  );
  for (const { itemId, position, suggestion } of converted) {
    insert.run(
      itemId,
      position,
      suggestion.path,
      suggestion.startLine,
      suggestion.endLine,
      suggestion.replacement,
    );
  }
}

/** Every stored patch as suggestions. A patch no build could have stored stops the migration. */
function convertedSuggestions(db: DatabaseSync): SuggestionRow[] {
  const rows = db
    .prepare('SELECT id, path, patch FROM ura_items WHERE patch IS NOT NULL ORDER BY rowid;')
    .all();
  return rows.flatMap((row) => {
    const itemId = String(row['id']);
    const { path, patch } = row;
    if (typeof path !== 'string' || typeof patch !== 'string') {
      throw new TypeError(`ura-0004-suggestions: item ${itemId} has a patch but no path`);
    }
    const parsed = parseSuggestedPatch(patch, { kind: 'file', path });
    if (!parsed.ok) {
      throw new Error(
        `ura-0004-suggestions: item ${itemId}'s patch is unreadable: ${parsed.error.reason}`,
      );
    }
    return uraSuggestionsFromPatch(parsed.value).map((suggestion, position): SuggestionRow => {
      return { itemId, position, suggestion };
    });
  });
}

function sha(column: string): string {
  return `length(${column}) IN (40, 64) AND ${column} NOT GLOB '*[^0-9a-f]*'`;
}

function timestamp(column: string): string {
  return `${column} GLOB '${digits(4)}-${digits(2)}-${digits(2)}T${digits(2)}:${digits(2)}:${digits(2)}.${digits(3)}Z'`;
}

function digits(count: number): string {
  return '[0-9]'.repeat(count);
}
