import { describe } from 'vitest';

import { readVerdictChoice } from './read-verdict-choice.ts';
import { settleVerdictChoice } from './settle-verdict-choice.ts';
import type { SessionId } from './ura-item.ts';
import { writeVerdictChoice } from './write-verdict-choice.ts';
import { test } from './testing/test.ts';

describe('settleVerdictChoice', () => {
  test('drops an approval once a blocking note is staged, and remembers why', ({ expect, db }) => {
    writeVerdictChoice(db, session(), { chosen: 'approve', headSha: head() });
    expect(
      settleVerdictChoice(db, session(), { headSha: head(), isBlockingStaged: false }),
    ).toStrictEqual({
      chosen: 'approve',
      headSha: head(),
    });
    expect(
      settleVerdictChoice(db, session(), { headSha: head(), isBlockingStaged: true }),
    ).toStrictEqual({
      cleared: 'blocking-staged',
    });
    expect(readVerdictChoice(db, session())).toStrictEqual({ cleared: 'blocking-staged' });
  });

  test('keeps choices that a blocking note does not contradict', ({ expect, db }) => {
    writeVerdictChoice(db, session(), { chosen: 'comment', headSha: head() });
    expect(
      settleVerdictChoice(db, session(), { headSha: head(), isBlockingStaged: true }),
    ).toStrictEqual({
      chosen: 'comment',
      headSha: head(),
    });
    expect(
      settleVerdictChoice(db, session(), { headSha: head(), isBlockingStaged: false }),
    ).toStrictEqual({
      chosen: 'comment',
      headSha: head(),
    });
  });

  test('drops any choice once the head has moved, and remembers why', ({ expect, db }) => {
    writeVerdictChoice(db, session(), { chosen: 'request-changes', headSha: head() });
    expect(
      settleVerdictChoice(db, session(), { headSha: head(), isBlockingStaged: false }),
    ).toStrictEqual({
      chosen: 'request-changes',
      headSha: head(),
    });
    expect(
      settleVerdictChoice(db, session(), { headSha: later(), isBlockingStaged: false }),
    ).toStrictEqual({
      cleared: 'head-moved',
    });
    expect(readVerdictChoice(db, session())).toStrictEqual({ cleared: 'head-moved' });
    expect(
      settleVerdictChoice(db, session(), { headSha: later(), isBlockingStaged: false }),
    ).toStrictEqual({
      cleared: 'head-moved',
    });
  });

  test('lets a choice made at the new head stand', ({ expect, db }) => {
    writeVerdictChoice(db, session(), { chosen: 'comment', headSha: head() });
    settleVerdictChoice(db, session(), { headSha: later(), isBlockingStaged: false });
    writeVerdictChoice(db, session(), { chosen: 'comment', headSha: later() });
    expect(
      settleVerdictChoice(db, session(), { headSha: later(), isBlockingStaged: false }),
    ).toStrictEqual({
      chosen: 'comment',
      headSha: later(),
    });
  });
});

function session(): SessionId {
  return '11111111-1111-4111-8111-111111111111' as SessionId;
}

function head(): string {
  return 'a'.repeat(40);
}

function later(): string {
  return 'b'.repeat(40);
}
