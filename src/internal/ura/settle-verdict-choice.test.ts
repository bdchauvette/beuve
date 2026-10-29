import { describe, expect, it } from 'vitest';

import { readVerdictChoice } from './read-verdict-choice.ts';
import { settleVerdictChoice } from './settle-verdict-choice.ts';
import { createUraTestDatabase } from './testing/create-ura-test-database.ts';
import type { SessionId } from './ura-item.ts';
import { writeVerdictChoice } from './write-verdict-choice.ts';

const session = '11111111-1111-4111-8111-111111111111' as SessionId;
const now = new Date('2026-10-28T12:00:00.000Z');
const head = 'a'.repeat(40);
const later = 'b'.repeat(40);

describe('settleVerdictChoice', () => {
  it('drops an approval once a blocker is staged, and remembers why', () => {
    const db = createUraTestDatabase([session]);
    writeVerdictChoice(db, session, { chosen: 'approve', headSha: head }, now);
    expect(settleVerdictChoice(db, session, head, ['nit'], now)).toEqual({
      chosen: 'approve',
      headSha: head,
    });
    expect(settleVerdictChoice(db, session, head, ['nit', 'blocker'], now)).toEqual({
      cleared: 'blocker-staged',
    });
    expect(readVerdictChoice(db, session)).toEqual({ cleared: 'blocker-staged' });
  });

  it('keeps choices that a blocker does not contradict', () => {
    const db = createUraTestDatabase([session]);
    writeVerdictChoice(db, session, { chosen: 'comment', headSha: head }, now);
    expect(settleVerdictChoice(db, session, head, ['blocker'], now)).toEqual({
      chosen: 'comment',
      headSha: head,
    });
    expect(settleVerdictChoice(db, session, head, [], now)).toEqual({
      chosen: 'comment',
      headSha: head,
    });
  });

  it('drops any choice once the head has moved, and remembers why', () => {
    const db = createUraTestDatabase([session]);
    writeVerdictChoice(db, session, { chosen: 'request-changes', headSha: head }, now);
    expect(settleVerdictChoice(db, session, head, [], now)).toEqual({
      chosen: 'request-changes',
      headSha: head,
    });
    expect(settleVerdictChoice(db, session, later, [], now)).toEqual({ cleared: 'head-moved' });
    expect(readVerdictChoice(db, session)).toEqual({ cleared: 'head-moved' });
    expect(settleVerdictChoice(db, session, later, [], now)).toEqual({ cleared: 'head-moved' });
  });

  it('lets a choice made at the new head stand', () => {
    const db = createUraTestDatabase([session]);
    writeVerdictChoice(db, session, { chosen: 'comment', headSha: head }, now);
    settleVerdictChoice(db, session, later, [], now);
    writeVerdictChoice(db, session, { chosen: 'comment', headSha: later }, now);
    expect(settleVerdictChoice(db, session, later, [], now)).toEqual({
      chosen: 'comment',
      headSha: later,
    });
  });
});
