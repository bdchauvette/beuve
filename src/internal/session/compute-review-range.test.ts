import { describe, expect, it } from 'vitest';

import { advanceHead } from './advance-head.ts';
import { computeReviewRange } from './compute-review-range.ts';
import { recordCheckpoint } from './record-checkpoint.ts';
import type { CommitSha, Session, SessionDeps, SessionId } from './session.ts';

const rev1 = '1'.repeat(40) as CommitSha;
const rev2 = '2'.repeat(40) as CommitSha;
const deps: SessionDeps = {
  now: (): Date => new Date('2026-10-28T12:00:00Z'),
  newId: (): string => '00000000-0000-4000-8000-0000000000c1',
};
const session: Session = {
  id: '00000000-0000-4000-8000-000000000001' as SessionId,
  source: {
    kind: 'github-pull-request',
    repoPath: '/repo',
    baseRef: 'main',
    owner: 'acme',
    repo: 'beuve',
    number: 7,
  },
  headSha: rev1,
  review: { kind: 'unreviewed' },
  createdAt: '2026-10-28T12:00:00.000Z',
  updatedAt: '2026-10-28T12:00:00.000Z',
};

describe('computeReviewRange', () => {
  it('asks for the full change when never reviewed', () => {
    expect(computeReviewRange(session)).toEqual({ kind: 'full', baseRef: 'main', headSha: rev1 });
  });

  it('is up to date when the last checkpoint is the head', () => {
    const reviewed = recordCheckpoint(session, rev1, deps).session;
    expect(computeReviewRange(reviewed)).toEqual({ kind: 'up-to-date', headSha: rev1 });
  });

  it('asks for the interdiff once new commits arrive (Rev 1 to Rev 2)', () => {
    const reviewed = recordCheckpoint(session, rev1, deps).session;
    expect(computeReviewRange(advanceHead(reviewed, rev2, deps))).toEqual({
      kind: 'interdiff',
      fromReviewedSha: rev1,
      toHeadSha: rev2,
    });
  });
});
