import type { DatabaseSync } from 'node:sqlite';

import { describe } from 'vitest';

import { test } from './testing/test.ts';
import { testUraIds } from './testing/test-ura-ids.ts';

describe('uraFindingConfidenceMigration', () => {
  test.for<[string, Readonly<Record<string, string>>]>([
    ['a finding without a confidence', { chat_finding: '0' }],
    ['a finding with zero confidence', { chat_finding: '0', chat_confidence: '0' }],
    ['a finding with a confidence', { chat_finding: '0', chat_confidence: '0.5' }],
    ['a finding with full confidence', { chat_finding: '0', chat_confidence: '1' }],
    ['a proposed note without a confidence', { chat_proposal: '0' }],
  ])('accepts %s', ([, overrides], { expect, db }) => {
    insertRow(db, { ...finding(), ...overrides });
    expect(db.prepare('SELECT count(*) AS n FROM ura_items;').get()?.['n']).toBe(1);
  });

  test.for<[string, Readonly<Record<string, string>>]>([
    ['a confidence above 1', { chat_finding: '0', chat_confidence: '1.5' }],
    ['a negative confidence', { chat_finding: '0', chat_confidence: '-0.1' }],
    ['a confidence on a proposed note', { chat_proposal: '0', chat_confidence: '0.5' }],
    [
      'a confidence on a human note',
      { origin_kind: "'human'", chat_message_id: 'NULL', chat_confidence: '0.5' },
    ],
  ])('rejects %s', ([, overrides], { expect, db }) => {
    expect(() => {
      insertRow(db, { ...finding(), ...overrides });
    }).toThrow(/CHECK/u);
  });
});

function insertRow(db: DatabaseSync, row: Readonly<Record<string, string>>): void {
  db.exec(
    `INSERT INTO ura_items (${Object.keys(row).join(', ')}) VALUES (${Object.values(row).join(', ')});`,
  );
}

/** Column values as SQL literals: a staged chat item on lines 1–2, without its finding or note. */
function finding(): Readonly<Record<string, string>> {
  const at = "'2026-11-18T12:00:00.000Z'";
  return {
    id: `'${testUraIds.itemId(1)}'`,
    session_id: `'${testUraIds.sessionId}'`,
    position: '0',
    head_sha: `'${testUraIds.headSha}'`,
    anchor_kind: "'lines'",
    path: "'src/a.ts'",
    line_start: '1',
    line_end: '2',
    severity: "'issue'",
    blocking: '0',
    origin_kind: "'chat-answer'",
    chat_message_id: `'${testUraIds.messageId}'`,
    title: "'t'",
    body: "''",
    status: "'staged'",
    created_at: at,
    updated_at: at,
  };
}
