import { describe, expect, it } from 'vitest';

import { createUraTestDatabase } from './testing/create-ura-test-database.ts';

const session = '11111111-1111-4111-8111-111111111111';
const sha = 'a'.repeat(40);
const later = 'b'.repeat(40);
const at = '2026-10-28T12:00:00.000Z';

const checkFailed = /CHECK/u;
const foreignKeyFailed = /FOREIGN KEY/u;
const uniqueFailed = /UNIQUE/u;
const uniqueOrPrimaryFailed = /UNIQUE|PRIMARY KEY/u;

/** Column values as SQL literals: a staged human note on lines 1–2. */
const valid: Readonly<Record<string, string>> = {
  id: "'22222222-2222-4222-8222-222222222222'",
  session_id: `'${session}'`,
  position: '0',
  head_sha: `'${sha}'`,
  anchor_kind: "'lines'",
  path: "'src/a.ts'",
  line_start: '1',
  line_end: '2',
  severity: "'issue'",
  origin_kind: "'human'",
  title: "'t'",
  body: "''",
  status: "'staged'",
  created_at: `'${at}'`,
  updated_at: `'${at}'`,
};

const finding = {
  origin_kind: "'impact-finding'",
  impact_metric: "'cognitive-complexity'",
  impact_function: "'f'",
  impact_value: '20',
  impact_threshold: '15',
  impact_percentile: '90',
};

function insertSql(row: Readonly<Record<string, string>>): string {
  return `INSERT INTO ura_items (${Object.keys(row).join(', ')}) VALUES (${Object.values(row).join(', ')});`;
}

function withId(row: Readonly<Record<string, string>>, n: number): Record<string, string> {
  return { ...row, id: `'22222222-2222-4222-8222-${String(n).padStart(12, '0')}'` };
}

describe('uraMigrations', () => {
  it('accepts valid rows of every anchor, origin and status shape', () => {
    const db = createUraTestDatabase([session]);
    const rows = [
      valid,
      { ...valid, anchor_kind: "'file'", line_start: 'NULL', line_end: 'NULL', patch: "'p'" },
      { ...valid, anchor_kind: "'change'", path: 'NULL', line_start: 'NULL', line_end: 'NULL' },
      {
        ...valid,
        origin_kind: "'agent-insight'",
        insight_id: "'33333333-3333-4333-8333-333333333333'",
      },
      { ...valid, origin_kind: "'chat-answer'", chat_message_id: "'m1'" },
      { ...valid, ...finding },
      { ...valid, status: "'withdrawn'" },
      { ...valid, status: "'addressed'", addressed_sha: `'${later}'`, addressed_by: "'agent'" },
    ];
    for (const [index, row] of rows.entries()) {
      db.exec(insertSql(withId(row, index)));
    }
    expect(db.prepare('SELECT count(*) AS n FROM ura_items;').get()).toEqual({ n: rows.length });
  });

  it.each([
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
  ])('rejects an invalid %s', (column, value) => {
    const db = createUraTestDatabase([session]);
    expect(() => {
      db.exec(insertSql({ ...valid, [column]: value }));
    }).toThrow(checkFailed);
  });

  it.each([
    ['a file anchor with lines', { anchor_kind: "'file'" }],
    [
      'a whole-change anchor with a path',
      { anchor_kind: "'change'", line_start: 'NULL', line_end: 'NULL' },
    ],
    [
      'a patch on the whole change',
      { anchor_kind: "'change'", path: 'NULL', line_start: 'NULL', line_end: 'NULL', patch: "'p'" },
    ],
    ['a human note with an insight id', { insight_id: "'33333333-3333-4333-8333-333333333333'" }],
    ['an insight without its id', { origin_kind: "'agent-insight'" }],
    ['a line anchor without lines', { line_start: 'NULL', line_end: 'NULL' }],
    ['a chat answer without its message id', { origin_kind: "'chat-answer'" }],
    ['a finding without a function', { ...finding, impact_function: 'NULL' }],
    ['a finding without a percentile', { ...finding, impact_percentile: 'NULL' }],
    ['a finding with a percentile over 100', { ...finding, impact_percentile: '101' }],
    [
      'a finding on a whole file',
      { ...finding, anchor_kind: "'file'", line_start: 'NULL', line_end: 'NULL' },
    ],
    ['an addressed item without a head', { status: "'addressed'", addressed_by: "'agent'" }],
    [
      'a staged item with an addressed head',
      { addressed_sha: `'${later}'`, addressed_by: "'agent'" },
    ],
    [
      'an item addressed at its own head',
      { status: "'addressed'", addressed_sha: `'${sha}'`, addressed_by: "'agent'" },
    ],
  ])('rejects %s', (_name, overrides) => {
    const db = createUraTestDatabase([session]);
    expect(() => {
      db.exec(insertSql({ ...valid, ...overrides }));
    }).toThrow(checkFailed);
  });

  it('references sessions and cascades their deletion', () => {
    const db = createUraTestDatabase([session]);
    expect(() => {
      db.exec(insertSql({ ...valid, session_id: "'99999999-9999-4999-8999-999999999999'" }));
    }).toThrow(foreignKeyFailed);
    db.exec(insertSql(valid));
    db.exec(`DELETE FROM sessions WHERE id = '${session}';`);
    expect(db.prepare('SELECT count(*) AS n FROM ura_items;').get()).toEqual({ n: 0 });
  });

  it('stages an insight once, and a finding once per head and function', () => {
    const db = createUraTestDatabase([session]);
    const insight = {
      ...valid,
      origin_kind: "'agent-insight'",
      insight_id: "'33333333-3333-4333-8333-333333333333'",
    };
    db.exec(insertSql(withId(insight, 1)));
    expect(() => {
      db.exec(insertSql(withId(insight, 2)));
    }).toThrow(uniqueFailed);
    db.exec(insertSql(withId({ ...valid, ...finding }, 3)));
    expect(() => {
      db.exec(insertSql(withId({ ...valid, ...finding }, 4)));
    }).toThrow(uniqueFailed);
    db.exec(insertSql(withId({ ...valid, ...finding, head_sha: `'${later}'` }, 5)));
    db.exec(insertSql(withId({ ...valid, ...finding, impact_function: "'g'" }, 6)));
  });

  it('records at most one verdict choice per session', () => {
    const db = createUraTestDatabase([session]);
    db.exec(
      `INSERT INTO ura_verdict_choices (session_id, verdict, head_sha, updated_at) VALUES ('${session}', 'comment', '${later}', '${at}');`,
    );
    expect(() => {
      db.exec(
        `INSERT INTO ura_verdict_choices (session_id, verdict, head_sha, updated_at) VALUES ('${session}', 'approve', '${later}', '${at}');`,
      );
    }).toThrow(uniqueOrPrimaryFailed);
  });
});
