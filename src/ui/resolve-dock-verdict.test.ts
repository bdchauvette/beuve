import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { resolveDockVerdict } from './resolve-dock-verdict.ts';

describe('resolveDockVerdict', () => {
  test('uses the derived verdict until the reviewer picks another', ({ expect }) => {
    expect(resolveDockVerdict(undefined, 'comment', 0)).toStrictEqual({
      value: 'comment',
      source: 'derived',
    });
    expect(resolveDockVerdict('comment', 'comment', 0)).toStrictEqual({
      value: 'comment',
      source: 'derived',
    });
    expect(resolveDockVerdict('approve', 'comment', 0)).toStrictEqual({
      value: 'approve',
      source: 'chosen',
    });
    expect(resolveDockVerdict('request-changes', 'approve', 0)).toStrictEqual({
      value: 'request-changes',
      source: 'chosen',
    });
  });

  test('refuses to approve over staged blockers, keeping the derived verdict', ({ expect }) => {
    expect(resolveDockVerdict('approve', 'request-changes', 1)).toStrictEqual({
      value: 'request-changes',
      source: 'derived',
      refusal: "Can't approve while a blocker is staged: withdraw it or lower the severity.",
    });
    expect(resolveDockVerdict('approve', 'request-changes', 2).refusal).toContain(
      '2 blockers are staged',
    );
    expect(resolveDockVerdict('comment', 'request-changes', 2)).toStrictEqual({
      value: 'comment',
      source: 'chosen',
    });
  });
});
