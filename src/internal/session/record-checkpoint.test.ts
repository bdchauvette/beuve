import { recordCheckpoint } from './record-checkpoint.ts';
import type { CommitSha, Session, SessionId } from './session.ts';
import { test } from './testing/test.ts';

test(
  'recordCheckpoint records the reviewed range and makes it the review state',
  { concurrent: false },
  ({ expect, clock }) => {
    clock.set('2026-10-28T14:00:00Z');
    const session: Session = {
      id: '00000000-0000-4000-8000-000000000001' as SessionId,
      source: { kind: 'local', repoPath: '/repo', baseRef: 'main', headRef: 'feature' },
      headSha: 'b'.repeat(40) as CommitSha,
      review: { kind: 'unreviewed' },
      createdAt: '2026-10-28T12:00:00.000Z',
      updatedAt: '2026-10-28T12:00:00.000Z',
    };
    const reviewed = 'a'.repeat(40) as CommitSha;
    const fork = 'f'.repeat(40) as CommitSha;
    const { session: next, checkpoint } = recordCheckpoint(
      session,
      { baseSha: fork, headSha: reviewed },
      { newId: (): string => '00000000-0000-4000-8000-0000000000c1' },
    );
    expect(checkpoint).toStrictEqual({
      id: '00000000-0000-4000-8000-0000000000c1',
      sessionId: session.id,
      baseSha: fork,
      headSha: reviewed,
      createdAt: '2026-10-28T14:00:00.000Z',
    });
    expect(next).toStrictEqual({
      ...session,
      review: { kind: 'reviewed', checkpoint },
      updatedAt: '2026-10-28T14:00:00.000Z',
    });
  },
);
