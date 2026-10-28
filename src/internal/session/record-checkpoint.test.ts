import { describe, expect, it } from 'vitest';

import { recordCheckpoint } from './record-checkpoint.ts';
import type { CommitSha, Session, SessionDeps, SessionId } from './session.ts';

const session: Session = {
  id: '00000000-0000-4000-8000-000000000001' as SessionId,
  source: { kind: 'local', repoPath: '/repo', baseRef: 'main', headRef: 'feature' },
  headSha: 'b'.repeat(40) as CommitSha,
  review: { kind: 'unreviewed' },
  createdAt: '2026-10-28T12:00:00.000Z',
  updatedAt: '2026-10-28T12:00:00.000Z',
};
const deps: SessionDeps = {
  now: (): Date => new Date('2026-10-28T14:00:00Z'),
  newId: (): string => '00000000-0000-4000-8000-0000000000c1',
};

describe('recordCheckpoint', () => {
  it('records the reviewed commit and makes it the review state', () => {
    const reviewed = 'a'.repeat(40) as CommitSha;
    const { session: next, checkpoint } = recordCheckpoint(session, reviewed, deps);
    expect(checkpoint).toEqual({
      id: '00000000-0000-4000-8000-0000000000c1',
      sessionId: session.id,
      commitSha: reviewed,
      createdAt: '2026-10-28T14:00:00.000Z',
    });
    expect(next).toEqual({
      ...session,
      review: { kind: 'reviewed', checkpoint },
      updatedAt: '2026-10-28T14:00:00.000Z',
    });
  });
});
