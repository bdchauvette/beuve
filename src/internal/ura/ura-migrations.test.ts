import type { DatabaseSync } from 'node:sqlite';

import { describe } from 'vitest';
import { test } from './testing/test.ts';

function insertRow(db: DatabaseSync, row: Readonly<Record<string, string>>, id?: number): void {
  if (id === undefined) {
    db.exec(insertSql(row));
  } else {
    db.exec(insertSql(withId(row, id)));
  }
}

function insertSql(row: Readonly<Record<string, string>>): string {
  return `INSERT INTO ura_items (${Object.keys(row).join(', ')}) VALUES (${Object.values(row).join(', ')});`;
}

function withId(row: Readonly<Record<string, string>>, n: number): Record<string, string> {
  return { ...row, id: `'22222222-2222-4222-8222-${String(n).padStart(12, '0')}'` };
}

describe('uraMigrations', () => {
  test('accepts valid rows of every anchor, origin and status shape', ({ expect, db }) => {
    const rows = [
      valid(),
      { ...valid(), anchor_kind: "'file'", line_start: 'NULL', line_end: 'NULL', patch: "'p'" },
      { ...valid(), anchor_kind: "'change'", path: 'NULL', line_start: 'NULL', line_end: 'NULL' },
      { ...valid(), origin_kind: "'chat-answer'", chat_message_id: "'m1'", chat_finding: '0' },
      { ...valid(), origin_kind: "'chat-answer'", chat_message_id: "'m1'" },
      { ...valid(), status: "'withdrawn'" },
      { ...valid(), status: "'addressed'", addressed_sha: `'${later()}'`, addressed_by: "'agent'" },
    ];
    for (const [index, row] of rows.entries()) {
      insertRow(db, row, index);
    }
    expect(db.prepare('SELECT count(*) AS n FROM ura_items;').get()?.['n']).toBe(rows.length);
  });

  test.for<[string, string]>([
    ['position', '-1'],
    ['head_sha', "'ABC'"],
    ['severity', "'major'"],
    ['anchor_kind', "'hunk'"],
    ['line_start', '0'],
    ['line_end', '0'],
    ['path', "''"],
    ['origin_kind', "'bot'"],
    ['title', "' '"],
    ['status', "'pending'"],
    ['created_at', "'yesterday'"],
    ['updated_at', "'2026-10-28'"],
  ])('rejects an invalid %s', ([column, value], { expect, db }) => {
    expect(() => {
      insertRow(db, { ...valid(), [column]: value });
    }).toThrow(/CHECK/u);
  });

  test('allows an empty title only when the body says something', ({ expect, db }) => {
    insertRow(db, { ...valid(), title: "''", body: "'Nice.'" });
    expect(() => {
      insertRow(db, { ...valid(), title: "''", body: "' '" }, 1);
    }).toThrow(/CHECK/u);
  });

  test.for<[string, Record<string, string>]>([
    ['a file anchor with lines', { anchor_kind: "'file'" }],
    [
      'a whole-change anchor with a path',
      { anchor_kind: "'change'", line_start: 'NULL', line_end: 'NULL' },
    ],
    [
      'a patch on the whole change',
      { anchor_kind: "'change'", path: 'NULL', line_start: 'NULL', line_end: 'NULL', patch: "'p'" },
    ],
    ['a human note with a finding index', { chat_finding: '0' }],
    [
      'a negative finding index',
      { origin_kind: "'chat-answer'", chat_message_id: "'m'", chat_finding: '-1' },
    ],
    [
      'a review finding on a whole file',
      {
        origin_kind: "'chat-answer'",
        chat_message_id: "'m'",
        chat_finding: '0',
        anchor_kind: "'file'",
        line_start: 'NULL',
        line_end: 'NULL',
      },
    ],
    ['a line anchor without lines', { line_start: 'NULL', line_end: 'NULL' }],
    ['a chat answer without its message id', { origin_kind: "'chat-answer'" }],
    ['an unknown origin', { origin_kind: "'impact-finding'" }],
    ['an addressed item without a head', { status: "'addressed'", addressed_by: "'agent'" }],
    [
      'a staged item with an addressed head',
      { addressed_sha: `'${later()}'`, addressed_by: "'agent'" },
    ],
    [
      'an item addressed at its own head',
      { status: "'addressed'", addressed_sha: `'${sha()}'`, addressed_by: "'agent'" },
    ],
  ])('rejects %s', ([, overrides], { expect, db }) => {
    expect(() => {
      insertRow(db, { ...valid(), ...overrides });
    }).toThrow(/CHECK/u);
  });

  test('references sessions and cascades their deletion', ({ expect, db }) => {
    expect(() => {
      insertRow(db, { ...valid(), session_id: "'99999999-9999-4999-8999-999999999999'" });
    }).toThrow(/FOREIGN KEY/u);
    insertRow(db, valid());
    db.exec(`DELETE FROM sessions WHERE id = '${session()}';`);
    expect(db.prepare('SELECT count(*) AS n FROM ura_items;').get()?.['n']).toBe(0);
  });

  test('stages a review finding once', ({ expect, db }) => {
    const answer = { ...valid(), origin_kind: "'chat-answer'", chat_message_id: "'m1'" };
    insertRow(db, { ...answer, chat_finding: '0' }, 1);
    expect(() => {
      insertRow(db, { ...answer, chat_finding: '0' }, 2);
    }).toThrow(/UNIQUE/u);
    insertRow(db, { ...answer, chat_finding: '1' }, 7);
    insertRow(db, answer, 8);
    insertRow(db, answer, 9);
  });

  test('records at most one verdict choice per session', ({ expect, db }) => {
    db.exec(
      `INSERT INTO ura_verdict_choices (session_id, verdict, head_sha, updated_at) VALUES ('${session()}', 'comment', '${later()}', '${at()}');`,
    );
    expect(() => {
      db.exec(
        `INSERT INTO ura_verdict_choices (session_id, verdict, head_sha, updated_at) VALUES ('${session()}', 'approve', '${later()}', '${at()}');`,
      );
    }).toThrow(/UNIQUE|PRIMARY KEY/u);
  });
});

function session(): string {
  return '11111111-1111-4111-8111-111111111111';
}

function sha(): string {
  return 'a'.repeat(40);
}

function later(): string {
  return 'b'.repeat(40);
}

function at(): string {
  return '2026-10-28T12:00:00.000Z';
}

/** Column values as SQL literals: a staged human note on lines 1–2. */
function valid(): Readonly<Record<string, string>> {
  return {
    id: "'22222222-2222-4222-8222-222222222222'",
    session_id: `'${session()}'`,
    position: '0',
    head_sha: `'${sha()}'`,
    anchor_kind: "'lines'",
    path: "'src/a.ts'",
    line_start: '1',
    line_end: '2',
    severity: "'issue'",
    origin_kind: "'human'",
    title: "'t'",
    body: "''",
    status: "'staged'",
    created_at: `'${at()}'`,
    updated_at: `'${at()}'`,
  };
}
