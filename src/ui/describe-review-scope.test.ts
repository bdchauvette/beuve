import { describe, expect, it } from 'vitest';

import type { InterdiffFallbackView } from '#contract/ipc-contract.ts';

import { describeReviewScope } from './describe-review-scope.ts';

const from = { fromBaseSha: 'a'.repeat(40), fromHeadSha: 'b'.repeat(40) };

describe('describeReviewScope', () => {
  it('names each review kind', () => {
    expect(describeReviewScope({ kind: 'full' })).toBe('Full review');
    expect(describeReviewScope({ kind: 'up-to-date' })).toBe('Up to date');
    expect(describeReviewScope({ kind: 'interdiff', ...from, outcome: { kind: 'exact' } })).toBe(
      'Interdiff · exact',
    );
    expect(describeReviewScope({ kind: 'interdiff', ...from, outcome: { kind: 'rebased' } })).toBe(
      'Interdiff · rebased',
    );
  });

  it('explains why an interdiff fell back to a full review', () => {
    expect(fallback({ kind: 'conflicts', paths: ['a.ts'] })).toBe(
      'Full review · interdiff unavailable: the rebase conflicts in 1 file',
    );
    expect(fallback({ kind: 'git-too-old', version: 'git version 2.37.0', required: '2.38' })).toBe(
      'Full review · interdiff unavailable: needs git 2.38 (have git version 2.37.0)',
    );
    expect(fallback({ kind: 'reviewed-commits-missing' })).toBe(
      'Full review · interdiff unavailable: the reviewed commits are gone',
    );
  });
});

function fallback(reason: InterdiffFallbackView): string {
  return describeReviewScope({ kind: 'interdiff', ...from, outcome: { kind: 'fallback', reason } });
}
