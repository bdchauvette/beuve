import type { DatabaseSync } from 'node:sqlite';

import { describe } from 'vitest';

import { openDatabase } from '#sqlite/open-database.ts';
import { runMigrations } from '#sqlite/run-migrations.ts';
import type { Migration } from '#sqlite/run-migrations.ts';

import { listUraItems } from './list-ura-items.ts';
import { testUraIds } from './testing/test-ura-ids.ts';
import { test } from './testing/test.ts';
import { uraFindingConfidenceMigration } from './ura-finding-confidence-migration.ts';
import { uraMigrations } from './ura-migrations.ts';
import { uraSuggestionsMigration } from './ura-suggestions-migration.ts';

describe('uraSuggestionsMigration', () => {
  test('turns each hunk of a stored patch into a suggestion and drops the column', ({
    expect,
    closing,
  }) => {
    const db = closing(openDatabase(':memory:'));
    runMigrations(db, beforeSuggestions());
    db.prepare('INSERT INTO sessions (id) VALUES (?);').run(testUraIds.sessionId);
    insertItem(db, { n: 1, path: 'src/a.ts', patch: undefined });
    insertItem(db, {
      n: 2,
      path: 'src/a.ts',
      patch: [
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -1,3 +1,4 @@',
        ' one',
        '-two',
        '+TWO',
        '+2\r',
        ' three',
        '@@ -9,0 +11,1 @@',
        '+after nine',
        '@@ -20,2 +21,0 @@',
        '-gone',
        '-also gone',
        '\\ No newline at end of file',
        '',
      ].join('\n'),
    });
    insertItem(db, { n: 3, path: 'docs/ünï.md', patch: '@@ -4 +4 @@\n-x\n+y\n' });
    db.exec(
      `INSERT INTO ura_item_postings (item_id, target, session_id, url, head_sha, placement, posted_at)
       VALUES ('${testUraIds.itemId(2)}', 'github', '${testUraIds.sessionId}',
               'https://github.com/o/r/pull/1', '${testUraIds.headSha}', 'inline',
               '2026-11-27T12:00:00.000Z');`,
    );

    runMigrations(db, [uraSuggestionsMigration]);

    expect(
      db
        .prepare('SELECT * FROM ura_item_suggestions ORDER BY item_id, position;')
        .all()
        .map((row) => {
          return { ...row };
        }),
    ).toStrictEqual([
      suggestionRow({ n: 2, position: 0, path: 'src/a.ts', lines: [1, 3] }, 'one\nTWO\n2\r\nthree'),
      suggestionRow({ n: 2, position: 1, path: 'src/a.ts', lines: [10, 9] }, 'after nine'),
      suggestionRow({ n: 2, position: 2, path: 'src/a.ts', lines: [20, 21] }, ''),
      suggestionRow({ n: 3, position: 0, path: 'docs/ünï.md', lines: [4, 4] }, 'y'),
    ]);
    const columns = db
      .prepare('SELECT name FROM pragma_table_info(?);')
      .all('ura_items')
      .map((row) => {
        return row['name'];
      });
    expect(columns).not.toContain('patch');
    expect(db.prepare('SELECT count(*) AS n FROM ura_item_postings;').get()?.['n']).toBe(1);
    const items = listUraItems(db, testUraIds.sessionId);
    expect(
      items.ok &&
        items.value.map((item) => {
          return item.suggestions.length;
        }),
    ).toStrictEqual([0, 3, 1]);
  });

  test('refuses a stored patch no build could have written', ({ expect, closing }) => {
    const db = closing(openDatabase(':memory:'));
    runMigrations(db, beforeSuggestions());
    db.prepare('INSERT INTO sessions (id) VALUES (?);').run(testUraIds.sessionId);
    insertItem(db, { n: 1, path: 'src/a.ts', patch: 'not a patch' });
    expect(() => {
      runMigrations(db, [uraSuggestionsMigration]);
    }).toThrow(/unreadable/u);
    const stored = db.prepare('SELECT count(*) AS n FROM ura_items WHERE patch IS NOT NULL;').get();
    expect(stored?.['n']).toBe(1);
  });

  test.for<[string, string]>([
    ['line zero', "'src/a.ts', 0, 0, 'x'"],
    ['an end before the insertion point', "'src/a.ts', 5, 3, 'x'"],
    ['an empty path', "'', 1, 1, 'x'"],
  ])('rejects a suggestion row with %s', ([, values], { expect, db }) => {
    insertCurrentItem(db);
    expect(() => {
      db.exec(
        `INSERT INTO ura_item_suggestions (item_id, position, path, start_line, end_line, replacement)
         VALUES ('${testUraIds.itemId(1)}', 0, ${values});`,
      );
    }).toThrow(/CHECK/u);
  });

  test('cascades an item’s deletion to its suggestions and keys them by position', ({
    expect,
    db,
  }) => {
    insertCurrentItem(db);
    const insert = db.prepare(
      `INSERT INTO ura_item_suggestions (item_id, position, path, start_line, end_line, replacement)
       VALUES (?, ?, 'src/a.ts', 1, 1, 'x');`,
    );
    insert.run(testUraIds.itemId(1), 0);
    expect(() => {
      insert.run(testUraIds.itemId(1), 0);
    }).toThrow(/UNIQUE|PRIMARY KEY/u);
    db.prepare('DELETE FROM ura_items WHERE id = ?;').run(testUraIds.itemId(1));
    expect(db.prepare('SELECT count(*) AS n FROM ura_item_suggestions;').get()?.['n']).toBe(0);
  });
});

/** The URA schema just before suggestions, on a stub `sessions` table. */
function beforeSuggestions(): readonly Migration[] {
  return [
    { id: 'test-0000-sessions-stub', up: 'CREATE TABLE sessions (id TEXT PRIMARY KEY) STRICT;' },
    ...uraMigrations,
    uraFindingConfidenceMigration,
  ];
}

/** An item to insert at the old schema: its number, its file and its stored patch. */
interface OldItem {
  readonly n: number;
  readonly path: string;
  readonly patch: string | undefined;
}

function insertItem(db: DatabaseSync, { n, path, patch = '' }: OldItem): void {
  db.prepare(
    `INSERT INTO ura_items (id, session_id, position, head_sha, anchor_kind, path, severity,
                            blocking, origin_kind, title, body, patch, status, created_at,
                            updated_at)
     VALUES (?, ?, ?, ?, 'file', ?, 'issue', 0, 'human', 't', '', NULLIF(?, ''), 'staged',
             '2026-11-27T12:00:00.000Z', '2026-11-27T12:00:00.000Z');`,
  ).run(testUraIds.itemId(n), testUraIds.sessionId, n, testUraIds.headSha, path, patch);
}

function insertCurrentItem(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO ura_items (id, session_id, position, head_sha, anchor_kind, path, severity,
                            blocking, origin_kind, title, body, status, created_at, updated_at)
     VALUES (?, ?, 0, ?, 'change', NULL, 'issue', 0, 'human', '', '', 'staged',
             '2026-11-27T12:00:00.000Z', '2026-11-27T12:00:00.000Z');`,
  ).run(testUraIds.itemId(1), testUraIds.sessionId, testUraIds.headSha);
}

/** Where a converted suggestion is: its item's number, its position, its path and lines. */
interface SuggestionPlace {
  readonly n: number;
  readonly position: number;
  readonly path: string;
  readonly lines: readonly [number, number];
}

function suggestionRow(
  { n, position, path, lines }: SuggestionPlace,
  replacement: string,
): Record<string, unknown> {
  return {
    item_id: testUraIds.itemId(n),
    position,
    path,
    start_line: lines[0],
    end_line: lines[1],
    replacement,
  };
}
