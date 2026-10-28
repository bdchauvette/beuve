import { describe, expect, it } from 'vitest';

import { advanceHead } from './advance-head.ts';
import type { CommitSha, Session, SessionId } from './session.ts';

const session: Session = {
  id: '00000000-0000-4000-8000-000000000001' as SessionId,
  source: { kind: 'local', repoPath: '/repo', baseRef: 'main', headRef: 'feature' },
  headSha: 'a'.repeat(40) as CommitSha,
  review: { kind: 'unreviewed' },
  createdAt: '2026-10-28T12:00:00.000Z',
  updatedAt: '2026-10-28T12:00:00.000Z',
};
const later = { now: (): Date => new Date('2026-10-28T13:00:00Z') };

describe('advanceHead', () => {
  it('moves the head and touches updatedAt', () => {
    const next = 'b'.repeat(40) as CommitSha;
    expect(advanceHead(session, next, later)).toEqual({
      ...session,
      headSha: next,
      updatedAt: '2026-10-28T13:00:00.000Z',
    });
  });

  it('returns the same session when the head is unchanged', () => {
    expect(advanceHead(session, session.headSha, later)).toBe(session);
  });
});
