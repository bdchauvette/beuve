import { describe } from 'vitest';

import { test } from '../testing/test.ts';
import { waitingSinceFrom } from './waiting-since-from.ts';
import type { WaitingInput, WaitingSince } from './waiting-since-from.ts';

function input(overrides: Partial<WaitingInput>): WaitingInput {
  return {
    owner: 'Octo-Org',
    author: 'rita',
    updatedAt: '2026-10-30T00:00:00Z',
    request: 'direct',
    isAuthored: false,
    viewer: 'Me',
    teams: new Set(['octo-org/core']),
    requestEvents: [
      { at: '2026-10-01T00:00:00Z', reviewer: 'me' },
      { at: '2026-10-02T00:00:00Z', reviewer: 'sam' },
      { at: '2026-10-03T00:00:00Z', team: 'core' },
      { at: '2026-10-04T00:00:00Z', team: 'docs' },
    ],
    reviews: [],
    ...overrides,
  };
}

function requested(at: string): WaitingSince {
  return { waitingSince: at, waitingSinceSource: 'requested' };
}

function updated(): WaitingSince {
  return { waitingSince: '2026-10-30T00:00:00Z', waitingSinceSource: 'updated' };
}

describe('waitingSinceFrom', () => {
  test.for<[string, Partial<WaitingInput>, WaitingSince]>([
    [
      'the latest request of the viewer or one of their teams',
      {},
      requested('2026-10-03T00:00:00Z'),
    ],
    [
      'a re-request after a review wins',
      {
        requestEvents: [
          { at: '2026-10-01T00:00:00Z', reviewer: 'me' },
          { at: '2026-10-05T00:00:00+02:00', reviewer: 'me' },
        ],
      },
      requested('2026-10-05T00:00:00+02:00'),
    ],
    [
      'a direct request without the viewer’s event falls back to the last update',
      { requestEvents: [{ at: '2026-10-02T00:00:00Z', reviewer: 'sam' }] },
      updated(),
    ],
    [
      'a team request with unreadable teams takes the latest of the viewer’s and any team’s',
      { request: 'team', teams: undefined },
      requested('2026-10-04T00:00:00Z'),
    ],
    [
      'a team request with the viewer’s team takes that team’s',
      { request: 'team', viewer: 'nobody' },
      requested('2026-10-03T00:00:00Z'),
    ],
    ['unread events fall back to the last update', { requestEvents: undefined }, updated()],
    [
      'the viewer’s own pull request waits since changes were last requested',
      {
        request: undefined,
        isAuthored: true,
        author: 'me',
        reviews: [
          {
            reviewer: 'sam',
            verdict: 'changes-requested',
            commitSha: undefined,
            submittedAt: '2026-10-07T00:00:00Z',
          },
          {
            reviewer: 'kim',
            verdict: 'changes-requested',
            commitSha: undefined,
            submittedAt: '2026-10-08T00:00:00Z',
          },
          {
            reviewer: 'sam',
            verdict: 'approved',
            commitSha: undefined,
            submittedAt: '2026-10-09T00:00:00Z',
          },
        ],
      },
      { waitingSince: '2026-10-08T00:00:00Z', waitingSinceSource: 'changes-requested' },
    ],
    [
      'the viewer’s own pull request without changes requested waits since its last update',
      { request: undefined, isAuthored: true, author: 'me' },
      updated(),
    ],
  ])('%s', ([, overrides, expected], { expect }) => {
    expect(waitingSinceFrom(input(overrides))).toStrictEqual(expected);
  });
});
