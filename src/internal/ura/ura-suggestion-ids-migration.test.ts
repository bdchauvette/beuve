import type { DatabaseSync } from 'node:sqlite';

import { describe } from 'vitest';

import { openDatabase } from '#sqlite/open-database.ts';
import { runMigrations } from '#sqlite/run-migrations.ts';
import type { Migration } from '#sqlite/run-migrations.ts';
import { isUuid } from '#x/text/is-uuid.ts';

import { listUraItems } from './list-ura-items.ts';
import { listUraPostings } from './list-ura-postings.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';
import { testUraIds } from './testing/test-ura-ids.ts';
import { test } from './testing/test.ts';
import { uraFindingConfidenceMigration } from './ura-finding-confidence-migration.ts';
import { uraMigrations } from './ura-migrations.ts';
import { uraPostingPiecesMigration } from './ura-posting-pieces-migration.ts';
import { uraSuggestionIdsMigration } from './ura-suggestion-ids-migration.ts';
import { uraSuggestionsMigration } from './ura-suggestions-migration.ts';

describe('uraSuggestionIdsMigration', () => {
  test('gives each suggestion an id, and each suggestion posting the id at its position', ({
    expect,
    closing,
  }) => {
    const db = closing(openDatabase(':memory:'));
    runMigrations(db, beforeIds());
    db.prepare('INSERT INTO sessions (id) VALUES (?);').run(testUraIds.sessionId);
    insertItem(db, 1);
    insertItem(db, 2);
    const suggestion = db.prepare(
      `INSERT INTO ura_item_suggestions (item_id, position, path, start_line, end_line, replacement)
       VALUES (?, ?, 'src/a.ts', ?, ?, 'x');`,
    );
    suggestion.run(testUraIds.itemId(1), 0, 1, 1);
    suggestion.run(testUraIds.itemId(1), 1, 5, 6);
    suggestion.run(testUraIds.itemId(2), 0, 3, 3);
    const posting = db.prepare(
      `INSERT INTO ura_item_postings
         (item_id, target, piece, position, session_id, url, head_sha, placement, posted_at)
       VALUES (?, 'github', ?, ?, ?, 'https://github.com/o/r/pull/1', ?, ?,
               '2026-11-27T12:00:00.000Z');`,
    );
    const { sessionId, headSha } = testUraIds;
    posting.run(testUraIds.itemId(1), 'note', 0, sessionId, headSha, 'comment');
    posting.run(testUraIds.itemId(1), 'suggestion', 1, sessionId, headSha, 'suggestion-comment');
    posting.run(testUraIds.itemId(1), 'suggestion', 4, sessionId, headSha, 'body');

    runMigrations(db, [uraSuggestionIdsMigration]);

    const items = okValueFrom(listUraItems(db, sessionId));
    const ids = items.flatMap((item) => {
      return item.suggestions.map((kept) => kept.id);
    });
    expect(ids.filter((id) => isUuid(id))).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(
      listUraPostings(db, sessionId).map(({ piece, placement }) => {
        return { piece, placement };
      }),
    ).toStrictEqual([
      { piece: { kind: 'note' }, placement: 'comment' },
      {
        piece: { kind: 'suggestion', suggestionId: items[0]?.suggestions[1]?.id },
        placement: 'suggestion-comment',
      },
    ]);
  });

  test.for<[string, string]>([
    ['a note piece naming a suggestion', `'note', '${testUraIds.suggestionId(1)}', 'body'`],
    ['a note piece in a suggestion’s comment', "'note', '', 'suggestion-comment'"],
    ['a suggestion piece without an id', "'suggestion', '', 'body'"],
    ['an unknown piece', "'title', '', 'body'"],
  ])('rejects a posting row with %s', ([, values], { expect, db }) => {
    insertItem(db, 1);
    expect(() => {
      db.exec(
        `INSERT INTO ura_item_postings
           (item_id, target, piece, suggestion_id, placement, session_id, url, head_sha, posted_at)
         VALUES ('${testUraIds.itemId(1)}', 'github', ${values}, '${testUraIds.sessionId}',
                 'https://github.com/o/r/pull/1', '${testUraIds.headSha}',
                 '2026-11-27T12:00:00.000Z');`,
      );
    }).toThrow(/CHECK/u);
  });

  test('refuses one suggestion id twice in an item, and an id that is no UUID', ({
    expect,
    db,
  }) => {
    insertItem(db, 1);
    const insert = db.prepare(
      `INSERT INTO ura_item_suggestions
         (item_id, position, id, path, start_line, end_line, replacement)
       VALUES (?, ?, ?, 'src/a.ts', ?, ?, 'x');`,
    );
    insert.run(testUraIds.itemId(1), 0, testUraIds.suggestionId(1), 1, 1);
    expect(() => {
      insert.run(testUraIds.itemId(1), 1, testUraIds.suggestionId(1), 5, 5);
    }).toThrow(/UNIQUE/u);
    expect(() => {
      insert.run(testUraIds.itemId(1), 1, 'NOT-A-UUID-NOT-A-UUID-NOT-A-UUID-NOT', 5, 5);
    }).toThrow(/CHECK/u);
  });
});

/** The URA schema just before suggestions had ids, on a stub `sessions` table. */
function beforeIds(): readonly Migration[] {
  return [
    { id: 'test-0000-sessions-stub', up: 'CREATE TABLE sessions (id TEXT PRIMARY KEY) STRICT;' },
    ...uraMigrations,
    uraFindingConfidenceMigration,
    uraSuggestionsMigration,
    uraPostingPiecesMigration,
  ];
}

function insertItem(db: DatabaseSync, n: number): void {
  db.prepare(
    `INSERT INTO ura_items (id, session_id, position, head_sha, anchor_kind, path, severity,
                            blocking, origin_kind, title, body, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'file', 'src/a.ts', 'issue', 0, 'human', 't', '', 'staged',
             '2026-11-27T12:00:00.000Z', '2026-11-27T12:00:00.000Z');`,
  ).run(testUraIds.itemId(n), testUraIds.sessionId, n, testUraIds.headSha);
}
