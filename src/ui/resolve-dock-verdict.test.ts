import { describe, expect, it } from 'vitest';

import { resolveDockVerdict } from './resolve-dock-verdict.ts';

describe('resolveDockVerdict', () => {
  it('uses the derived verdict until the reviewer picks another', () => {
    expect(resolveDockVerdict(undefined, 'comment', 0)).toEqual({
      value: 'comment',
      source: 'derived',
    });
    expect(resolveDockVerdict('comment', 'comment', 0)).toEqual({
      value: 'comment',
      source: 'derived',
    });
    expect(resolveDockVerdict('approve', 'comment', 0)).toEqual({
      value: 'approve',
      source: 'chosen',
    });
    expect(resolveDockVerdict('request-changes', 'approve', 0)).toEqual({
      value: 'request-changes',
      source: 'chosen',
    });
  });

  it('refuses to approve over staged blockers, keeping the derived verdict', () => {
    expect(resolveDockVerdict('approve', 'request-changes', 1)).toEqual({
      value: 'request-changes',
      source: 'derived',
      refusal: "Can't approve while a blocker is staged: withdraw it or lower the severity.",
    });
    expect(resolveDockVerdict('approve', 'request-changes', 2).refusal).toContain(
      '2 blockers are staged',
    );
    expect(resolveDockVerdict('comment', 'request-changes', 2)).toEqual({
      value: 'comment',
      source: 'chosen',
    });
  });
});
