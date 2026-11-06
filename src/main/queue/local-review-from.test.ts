import { describe } from 'vitest';

import type { CheckpointId, CommitSha, Session, SessionId } from '#internal/session/session.ts';

import { test } from '../testing/test.ts';
import { localReviewFrom } from './local-review-from.ts';

function sha(digit: string): CommitSha {
  return digit.repeat(40) as CommitSha;
}

function session(checkpointHead: string | undefined): Session {
  const base = {
    id: 's1' as SessionId,
    source: {
      kind: 'github-pull-request',
      repoPath: '/w/r',
      baseRef: 'refs/beuve/pr/7/base',
      host: 'github.com',
      owner: 'o',
      repo: 'r',
      number: 7,
    },
    headSha: sha('b'),
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  } as const;
  if (checkpointHead === undefined) {
    return { ...base, review: { kind: 'unreviewed' } };
  }
  return {
    ...base,
    review: {
      kind: 'reviewed',
      checkpoint: {
        id: 'c1' as CheckpointId,
        sessionId: base.id,
        baseSha: sha('a'),
        headSha: checkpointHead as CommitSha,
        createdAt: '2026-10-01T00:00:00.000Z',
      },
    },
  };
}

describe('localReviewFrom', () => {
  test.for([
    ['never opened', undefined, 0, sha('b'), { state: 'none' }],
    [
      'opened, nothing marked',
      session(undefined),
      0,
      sha('b'),
      { state: 'opened', markedFiles: 0 },
    ],
    ['files marked, no checkpoint', session(undefined), 3, sha('b'), { state: 'partial' }],
    ['checkpoint on the current head', session(sha('b')), 1, sha('b'), { state: 'reviewed' }],
    [
      'checkpoint, then new commits on GitHub',
      session(sha('b')),
      0,
      sha('c'),
      { state: 'new-commits' },
    ],
    [
      'checkpoint behind the session head',
      session(sha('a')),
      0,
      undefined,
      { state: 'new-commits' },
    ],
    [
      'checkpoint on the session head, GitHub unknown',
      session(sha('b')),
      0,
      undefined,
      { state: 'reviewed' },
    ],
  ] as const)('%s', ([, found, markedFiles, headSha, expected], { expect }) => {
    expect(localReviewFrom({ session: found, markedFiles, headSha })).toMatchObject(expected);
  });

  test('names the session and its marks', ({ expect }) => {
    expect(
      localReviewFrom({ session: session(undefined), markedFiles: 2, headSha: undefined }),
    ).toStrictEqual({ state: 'partial', sessionId: 's1', markedFiles: 2 });
  });
});
