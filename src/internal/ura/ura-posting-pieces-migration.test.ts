import type { DatabaseSync } from 'node:sqlite';

import { describe } from 'vitest';

import { openDatabase } from '#sqlite/open-database.ts';
import { runMigrations } from '#sqlite/run-migrations.ts';
import type { Migration } from '#sqlite/run-migrations.ts';

import { testUraIds } from './testing/test-ura-ids.ts';
import { test } from './testing/test.ts';
import { uraFindingConfidenceMigration } from './ura-finding-confidence-migration.ts';
import { uraMigrations } from './ura-migrations.ts';
import { uraPostingPiecesMigration } from './ura-posting-pieces-migration.ts';
import { uraSuggestionsMigration } from './ura-suggestions-migration.ts';

describe('uraPostingPiecesMigration', () => {
  test('keeps every posted note posted: its text, and each suggestion where the note went', ({
    expect,
    closing,
  }) => {
    const db = closing(openDatabase(':memory:'));
    runMigrations(db, beforePieces());
    db.prepare('INSERT INTO sessions (id) VALUES (?);').run(testUraIds.sessionId);
    insertItem(db, 1);
    insertItem(db, 2);
    insertItem(db, 3);
    const suggestion = db.prepare(
      `INSERT INTO ura_item_suggestions (item_id, position, path, start_line, end_line, replacement)
       VALUES (?, ?, 'src/a.ts', ?, ?, 'x');`,
    );
    suggestion.run(testUraIds.itemId(1), 0, 1, 1);
    suggestion.run(testUraIds.itemId(1), 1, 5, 6);
    suggestion.run(testUraIds.itemId(2), 0, 3, 3);
    suggestion.run(testUraIds.itemId(3), 0, 3, 3);
    const posting = db.prepare(
      `INSERT INTO ura_item_postings (item_id, target, session_id, url, head_sha, placement, posted_at)
       VALUES (?, 'github', ?, 'https://github.com/o/r/pull/1', ?, ?, '2026-11-27T12:00:00.000Z');`,
    );
    posting.run(testUraIds.itemId(1), testUraIds.sessionId, testUraIds.headSha, 'inline');
    posting.run(testUraIds.itemId(2), testUraIds.sessionId, testUraIds.headSha, 'body');

    runMigrations(db, [uraPostingPiecesMigration]);

    expect(
      db
        .prepare(
          `SELECT item_id, piece, position, placement FROM ura_item_postings
            ORDER BY item_id, piece, position;`,
        )
        .all()
        .map((row) => {
          return { ...row };
        }),
    ).toStrictEqual([
      pieceRow({ n: 1, piece: 'note', position: 0 }, 'comment'),
      pieceRow({ n: 1, piece: 'suggestion', position: 0 }, 'comment'),
      pieceRow({ n: 1, piece: 'suggestion', position: 1 }, 'comment'),
      pieceRow({ n: 2, piece: 'note', position: 0 }, 'body'),
      pieceRow({ n: 2, piece: 'suggestion', position: 0 }, 'body'),
    ]);
  });

  test.for<[string, string]>([
    ['a note piece at a position', "'note', 1, 'body'"],
    ['a note piece in a suggestion’s comment', "'note', 0, 'suggestion-comment'"],
    ['the old inline placement', "'note', 0, 'inline'"],
    ['a negative position', "'suggestion', -1, 'body'"],
    ['an unknown piece', "'title', 0, 'body'"],
  ])('rejects a posting row with %s', ([, values], { expect, closing }) => {
    const db = closing(openDatabase(':memory:'));
    runMigrations(db, [...beforePieces(), uraPostingPiecesMigration]);
    db.prepare('INSERT INTO sessions (id) VALUES (?);').run(testUraIds.sessionId);
    db.exec(
      `INSERT INTO ura_items (id, session_id, position, head_sha, anchor_kind, path, severity,
                              blocking, origin_kind, title, body, status, created_at, updated_at)
       VALUES ('${testUraIds.itemId(1)}', '${testUraIds.sessionId}', 0, '${testUraIds.headSha}',
               'change', NULL, 'issue', 0, 'human', 't', '', 'staged',
               '2026-11-27T12:00:00.000Z', '2026-11-27T12:00:00.000Z');`,
    );
    expect(() => {
      db.exec(
        `INSERT INTO ura_item_postings
           (item_id, target, piece, position, placement, session_id, url, head_sha, posted_at)
         VALUES ('${testUraIds.itemId(1)}', 'github', ${values}, '${testUraIds.sessionId}',
                 'https://github.com/o/r/pull/1', '${testUraIds.headSha}',
                 '2026-11-27T12:00:00.000Z');`,
      );
    }).toThrow(/CHECK/u);
  });
});

/** The URA schema just before postings had pieces, on a stub `sessions` table. */
function beforePieces(): readonly Migration[] {
  return [
    { id: 'test-0000-sessions-stub', up: 'CREATE TABLE sessions (id TEXT PRIMARY KEY) STRICT;' },
    ...uraMigrations,
    uraFindingConfidenceMigration,
    uraSuggestionsMigration,
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

/** Which piece of which item a posting row is. */
interface PieceOf {
  readonly n: number;
  readonly piece: 'note' | 'suggestion';
  readonly position: number;
}

function pieceRow({ n, piece, position }: PieceOf, placement: string): Record<string, unknown> {
  return { item_id: testUraIds.itemId(n), piece, position, placement };
}
