import { describe, expect, it } from 'vitest';

import { readVerdictChoice } from './read-verdict-choice.ts';
import { createUraTestDatabase } from './testing/create-ura-test-database.ts';
import type { SessionId } from './ura-item.ts';
import { writeVerdictChoice } from './write-verdict-choice.ts';

const session = '11111111-1111-4111-8111-111111111111' as SessionId;
const head = 'a'.repeat(40);
const now = new Date('2026-10-28T12:00:00.000Z');
const checkFailed = /CHECK/u;

describe('writeVerdictChoice', () => {
  it('round-trips a choice, replaces it and clears it', () => {
    const db = createUraTestDatabase([session]);
    expect(readVerdictChoice(db, session)).toEqual({});
    writeVerdictChoice(db, session, { chosen: 'comment', headSha: head }, now);
    expect(readVerdictChoice(db, session)).toEqual({ chosen: 'comment', headSha: head });
    writeVerdictChoice(db, session, { chosen: 'approve', headSha: head }, now);
    expect(readVerdictChoice(db, session)).toEqual({ chosen: 'approve', headSha: head });
    writeVerdictChoice(db, session, { cleared: 'blocker-staged' }, now);
    expect(readVerdictChoice(db, session)).toEqual({ cleared: 'blocker-staged' });
    writeVerdictChoice(db, session, { cleared: 'head-moved' }, now);
    expect(readVerdictChoice(db, session)).toEqual({ cleared: 'head-moved' });
    writeVerdictChoice(db, session, {}, now);
    expect(readVerdictChoice(db, session)).toEqual({});
  });

  it('refuses an unknown session and cascades with the session', () => {
    const db = createUraTestDatabase([session]);
    const other = '99999999-9999-4999-8999-999999999999' as SessionId;
    expect(writeVerdictChoice(db, other, { chosen: 'comment', headSha: head }, now)).toEqual({
      ok: false,
      error: { kind: 'session-not-found', sessionId: other },
    });
    writeVerdictChoice(db, session, { chosen: 'comment', headSha: head }, now);
    db.exec(`DELETE FROM sessions WHERE id = '${session}';`);
    expect(readVerdictChoice(db, session)).toEqual({});
  });

  it('is constrained by the table: no unknown verdicts, no choice and clear together', () => {
    const db = createUraTestDatabase([session]);
    const insert = (verdict: string, cleared: string, headSha = `'${head}'`): string =>
      `INSERT INTO ura_verdict_choices VALUES ('${session}', ${verdict}, ${cleared}, ${headSha}, '2026-10-28T12:00:00.000Z');`;
    expect(() => {
      db.exec(insert("'ship-it'", 'NULL'));
    }).toThrow(checkFailed);
    expect(() => {
      db.exec(insert("'approve'", "'blocker-staged'"));
    }).toThrow(checkFailed);
    expect(() => {
      db.exec(insert("'approve'", 'NULL', 'NULL'));
    }).toThrow(checkFailed);
    expect(() => {
      db.exec(insert('NULL', "'head-moved'"));
    }).toThrow(checkFailed);
  });
});
