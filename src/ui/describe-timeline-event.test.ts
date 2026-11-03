import { describe } from 'vitest';

import type { ReviewTimelineEventView, TimelineVerdictView } from '#contract/ipc-contract.ts';

import { describeTimelineEvent } from './describe-timeline-event.ts';
import { test } from './testing/test.ts';

function review(verdict: TimelineVerdictView): ReviewTimelineEventView {
  return {
    kind: 'review',
    verdict,
    author: 'rita',
    body: '',
    at: '2026-10-01T10:00:00Z',
    url: 'u',
  };
}

describe('describeTimelineEvent', () => {
  test('words each kind of event', ({ expect }) => {
    expect(
      describeTimelineEvent({
        kind: 'commit',
        sha: 'a',
        headline: 'h',
        author: 'ann',
        at: '2026-10-01T10:00:00Z',
        url: 'u',
      }),
    ).toStrictEqual({ verb: 'pushed a commit', tone: 'muted' });
    expect(
      describeTimelineEvent({
        kind: 'comment',
        author: 'vic',
        body: 'hi',
        at: '2026-10-01T10:00:00Z',
        url: 'u',
      }),
    ).toStrictEqual({ verb: 'commented', tone: 'muted' });
  });

  test.for([
    ['approved', 'approved', 'ok'],
    ['changes-requested', 'requested changes', 'danger'],
    ['dismissed', 'had a review dismissed', 'warn'],
    ['commented', 'reviewed', 'muted'],
  ] as const)('words a %s review', ([verdict, verb, tone], { expect }) => {
    expect(describeTimelineEvent(review(verdict))).toStrictEqual({ verb, tone });
  });
});
