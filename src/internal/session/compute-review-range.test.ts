import { advanceHead } from './advance-head.ts';
import { computeReviewRange } from './compute-review-range.ts';
import { recordCheckpoint } from './record-checkpoint.ts';
import type { CommitSha, Session, SessionId } from './session.ts';
import { test } from './testing/test.ts';

test('computeReviewRange asks for the full change when never reviewed', ({ expect }) => {
  expect(computeReviewRange(session())).toStrictEqual({
    kind: 'full',
    baseRef: 'main',
    headSha: sha('1'),
  });
});

test('computeReviewRange is up to date when the last checkpoint is the head', ({
  expect,
  deps,
}) => {
  const reviewed = recordCheckpoint(session(), { baseSha: sha('f'), headSha: sha('1') }, deps);
  expect(computeReviewRange(reviewed.session)).toStrictEqual({
    kind: 'up-to-date',
    headSha: sha('1'),
  });
});

test('computeReviewRange asks for the interdiff once new commits arrive (Rev 1 to Rev 2)', ({
  expect,
  deps,
}) => {
  const reviewed = recordCheckpoint(session(), { baseSha: sha('f'), headSha: sha('1') }, deps);
  const pushed = advanceHead(reviewed.session, sha('2'));
  expect(computeReviewRange(pushed)).toStrictEqual({
    kind: 'interdiff',
    baseRef: 'main',
    fromBaseSha: sha('f'),
    fromHeadSha: sha('1'),
    toHeadSha: sha('2'),
  });
});

function sha(digit: string): CommitSha {
  return digit.repeat(40) as CommitSha;
}

function session(): Session {
  return {
    id: '00000000-0000-4000-8000-000000000001' as SessionId,
    source: {
      kind: 'github-pull-request',
      repoPath: '/repo',
      baseRef: 'main',
      host: 'github.com',
      owner: 'acme',
      repo: 'beuve',
      number: 7,
    },
    headSha: sha('1'),
    review: { kind: 'unreviewed' },
    createdAt: '2026-10-28T12:00:00.000Z',
    updatedAt: '2026-10-28T12:00:00.000Z',
  };
}
