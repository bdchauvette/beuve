import { describe } from 'vitest';

import { readVerdictChoice } from './read-verdict-choice.ts';
import type { SessionId } from './ura-item.ts';
import { writeVerdictChoice } from './write-verdict-choice.ts';
import { test } from './testing/test.ts';

describe('writeVerdictChoice', () => {
  test('round-trips a choice, replaces it and clears it', ({ expect, db }) => {
    expect(readVerdictChoice(db, session())).toStrictEqual({});
    writeVerdictChoice(db, session(), { chosen: 'comment', headSha: head() });
    expect(readVerdictChoice(db, session())).toStrictEqual({ chosen: 'comment', headSha: head() });
    writeVerdictChoice(db, session(), { chosen: 'approve', headSha: head() });
    expect(readVerdictChoice(db, session())).toStrictEqual({ chosen: 'approve', headSha: head() });
    writeVerdictChoice(db, session(), { cleared: 'blocker-staged' });
    expect(readVerdictChoice(db, session())).toStrictEqual({ cleared: 'blocker-staged' });
    writeVerdictChoice(db, session(), { cleared: 'head-moved' });
    expect(readVerdictChoice(db, session())).toStrictEqual({ cleared: 'head-moved' });
    writeVerdictChoice(db, session(), {});
    expect(readVerdictChoice(db, session())).toStrictEqual({});
  });

  test('refuses an unknown session and cascades with the session', ({ expect, db }) => {
    const other = '99999999-9999-4999-8999-999999999999' as SessionId;
    expect(writeVerdictChoice(db, other, { chosen: 'comment', headSha: head() })).toStrictEqual({
      ok: false,
      error: { kind: 'session-not-found', sessionId: other },
    });
    writeVerdictChoice(db, session(), { chosen: 'comment', headSha: head() });
    db.exec(`DELETE FROM sessions WHERE id = '${session()}';`);
    expect(readVerdictChoice(db, session())).toStrictEqual({});
  });

  test('is constrained by the table: no unknown verdicts, no choice and clear together', ({
    expect,
    db,
  }) => {
    expect(() => {
      db.exec(insertChoice({ verdict: "'ship-it'", cleared: 'NULL' }));
    }).toThrow(/CHECK/u);
    expect(() => {
      db.exec(insertChoice({ verdict: "'approve'", cleared: "'blocker-staged'" }));
    }).toThrow(/CHECK/u);
    expect(() => {
      db.exec(insertChoice({ verdict: "'approve'", cleared: 'NULL', headSha: 'NULL' }));
    }).toThrow(/CHECK/u);
    expect(() => {
      db.exec(insertChoice({ verdict: 'NULL', cleared: "'head-moved'" }));
    }).toThrow(/CHECK/u);
  });
});

function session(): SessionId {
  return '11111111-1111-4111-8111-111111111111' as SessionId;
}

function head(): string {
  return 'a'.repeat(40);
}

/** SQL literals for a stored choice's columns. */
interface ChoiceRow {
  readonly verdict: string;
  readonly cleared: string;
  readonly headSha?: string;
}

function insertChoice({ verdict, cleared, headSha = `'${head()}'` }: ChoiceRow): string {
  return `INSERT INTO ura_verdict_choices VALUES ('${session()}', ${verdict}, ${cleared}, ${headSha}, '2026-10-28T12:00:00.000Z');`;
}
