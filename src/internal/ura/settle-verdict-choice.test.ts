import { describe, expect, it } from 'vitest';

import { readVerdictChoice } from './read-verdict-choice.ts';
import { settleVerdictChoice } from './settle-verdict-choice.ts';
import { createUraTestDatabase } from './testing/create-ura-test-database.ts';
import type { SessionId } from './ura-item.ts';
import { writeVerdictChoice } from './write-verdict-choice.ts';

const session = '11111111-1111-4111-8111-111111111111' as SessionId;
const now = new Date('2026-10-28T12:00:00.000Z');

describe('settleVerdictChoice', () => {
  it('drops an approval once a blocker is staged, and remembers why', () => {
    const db = createUraTestDatabase([session]);
    writeVerdictChoice(db, session, { chosen: 'approve' }, now);
    expect(settleVerdictChoice(db, session, ['nit'], now)).toEqual({ chosen: 'approve' });
    expect(settleVerdictChoice(db, session, ['nit', 'blocker'], now)).toEqual({
      cleared: 'blocker-staged',
    });
    expect(readVerdictChoice(db, session)).toEqual({ cleared: 'blocker-staged' });
  });

  it('keeps choices that a blocker does not contradict', () => {
    const db = createUraTestDatabase([session]);
    writeVerdictChoice(db, session, { chosen: 'comment' }, now);
    expect(settleVerdictChoice(db, session, ['blocker'], now)).toEqual({ chosen: 'comment' });
    expect(settleVerdictChoice(db, session, [], now)).toEqual({ chosen: 'comment' });
  });
});
