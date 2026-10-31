import { describe } from 'vitest';

import { attentionFrom } from './attention-from.ts';
import type { AttentionInput } from './attention-from.ts';
import type { PullRequestReview } from './pull-request-review.ts';
import { test } from './testing/test.ts';

describe('attentionFrom', () => {
  test('is nobody’s when the pull request is closed or merged', ({ expect }) => {
    expect(attentionFrom(input({ state: 'merged' }))).toStrictEqual({
      turn: 'unknown',
      reasons: ['the pull request is merged'],
    });
    expect(attentionFrom(input({ state: 'closed' })).turn).toBe('unknown');
  });

  test('is the author’s while the pull request is a draft', ({ expect }) => {
    expect(attentionFrom(input({ isDraft: true }))).toStrictEqual({
      turn: 'author',
      reasons: ['it is a draft'],
    });
  });

  test('is the author’s after changes are requested on the current head', ({ expect }) => {
    const reviews = [review({ reviewer: 'rita', verdict: 'changes-requested', commitSha: head() })];
    const result = attentionFrom(input({ reviews, viewer: 'vic' }));
    expect(result).toStrictEqual({ turn: 'author', reasons: ['rita requested changes'] });
  });

  test('is the reviewer’s once the author pushed after changes were requested', ({ expect }) => {
    const reviews = [
      review({ reviewer: 'rita', verdict: 'changes-requested', commitSha: older() }),
    ];
    expect(attentionFrom(input({ reviews }))).toStrictEqual({
      turn: 'reviewers',
      reasons: ['the author pushed since rita requested changes'],
    });
    expect(attentionFrom(input({ reviews, viewer: 'rita' })).turn).toBe('you');
    expect(attentionFrom(input({ reviews, viewer: 'vic' })).turn).toBe('reviewers');
  });

  test('is the reviewer’s when a review was requested, and yours when it was requested from you', ({
    expect,
  }) => {
    const requests = { users: ['vic', 'rita'], teams: ['platform'] };
    const others = attentionFrom(input({ requests, viewer: 'zed' }));
    expect(others).toStrictEqual({
      turn: 'reviewers',
      reasons: [
        'a review was requested from vic',
        'a review was requested from rita',
        'a review was requested from team platform',
      ],
    });
    expect(attentionFrom(input({ requests, viewer: 'vic' })).turn).toBe('you');
    expect(
      attentionFrom(input({ requests: { users: [], teams: ['platform'] }, viewer: 'vic' })).turn,
    ).toBe('reviewers');
  });

  test('is the author’s when CI fails on the head(), ahead of waiting reviewers', ({ expect }) => {
    const result = attentionFrom(
      input({ ci: 'failure', failingChecks: 2, requests: { users: ['vic'], teams: [] } }),
    );
    expect(result).toStrictEqual({
      turn: 'author',
      reasons: ['CI is failing (2 checks)', 'a review was requested from vic'],
    });
    expect(attentionFrom(input({ ci: 'failure', failingChecks: 1 })).reasons).toStrictEqual([
      'CI is failing (1 check)',
    ]);
    expect(attentionFrom(input({ ci: 'failure' })).reasons).toStrictEqual(['CI is failing']);
  });

  test('says you when it is your own pull request and the author must act', ({ expect }) => {
    expect(attentionFrom(input({ viewer: 'ada', ci: 'failure' })).turn).toBe('you');
    expect(attentionFrom(input({ viewer: 'ada', isDraft: true })).turn).toBe('you');
  });

  test('takes each reviewer’s latest decision and ignores comments and dismissals', ({
    expect,
  }) => {
    const resolved = [
      review({ reviewer: 'rita', verdict: 'changes-requested', commitSha: older() }),
      review({ reviewer: 'rita', verdict: 'approved', commitSha: head() }),
      review({ reviewer: 'rita', verdict: 'commented', commitSha: head() }),
    ];
    expect(attentionFrom(input({ reviews: resolved, ci: 'success' }))).toStrictEqual({
      turn: 'author',
      reasons: ['approved on the current head with CI passing'],
    });
    const dismissed = [
      review({ reviewer: 'rita', verdict: 'changes-requested', commitSha: head() }),
      review({ reviewer: 'rita', verdict: 'dismissed', commitSha: head() }),
    ];
    expect(attentionFrom(input({ reviews: dismissed })).turn).toBe('unknown');
    const commentOnly = [review({ reviewer: 'rita', verdict: 'commented', commitSha: head() })];
    expect(attentionFrom(input({ reviews: commentOnly })).turn).toBe('unknown');
  });

  test('ignores the author’s own reviews and a re-request of the author', ({ expect }) => {
    const reviews = [review({ reviewer: 'ada', verdict: 'changes-requested', commitSha: head() })];
    expect(attentionFrom(input({ reviews })).turn).toBe('unknown');
  });

  test('is unknown when nothing is waiting, and when CI is still running on an approval', ({
    expect,
  }) => {
    expect(attentionFrom(input({}))).toStrictEqual({
      turn: 'unknown',
      reasons: ['nothing is waiting on anyone'],
    });
    const reviews = [review({ reviewer: 'rita', verdict: 'approved', commitSha: head() })];
    const waiting = attentionFrom(input({ reviews, ci: 'pending' }));
    expect(waiting.turn).toBe('unknown');
  });

  test('keeps an approval on an older() head() from reading as ready to merge', ({ expect }) => {
    const reviews = [review({ reviewer: 'rita', verdict: 'approved', commitSha: older() })];
    expect(attentionFrom(input({ reviews, ci: 'success' })).turn).toBe('unknown');
  });
});

function head(): string {
  return 'h'.repeat(40);
}

function older(): string {
  return 'o'.repeat(40);
}

function input(overrides: Partial<AttentionInput>): AttentionInput {
  return {
    viewer: undefined,
    author: 'ada',
    state: 'open',
    isDraft: false,
    headSha: head(),
    requests: { users: [], teams: [] },
    reviews: [],
    ci: undefined,
    ...overrides,
  };
}

function review({
  reviewer,
  verdict,
  commitSha,
}: Omit<PullRequestReview, 'submittedAt'>): PullRequestReview {
  return { reviewer, verdict, commitSha, submittedAt: '2026-10-01T12:00:00Z' };
}
