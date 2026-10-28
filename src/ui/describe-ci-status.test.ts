import { describe, expect, it } from 'vitest';

import { describeCiStatus } from './describe-ci-status.ts';

describe('describeCiStatus', () => {
  it('counts worst first and names failing and pending checks', () => {
    expect(
      describeCiStatus({
        sha: 'a'.repeat(40),
        overall: 'failure',
        counts: { failure: 1, pending: 1, success: 3, neutral: 0 },
        checks: [
          { name: 'test', bucket: 'failure' },
          { name: 'e2e', bucket: 'pending' },
          { name: 'lint', bucket: 'success' },
        ],
        isTruncated: false,
      }),
    ).toEqual({
      tone: 'danger',
      text: 'CI 1 failing · 1 pending · 3 passing',
      title: `Failing: test\nPending: e2e\nHead ${'a'.repeat(12)}`,
    });
  });

  it('says when there are no checks', () => {
    expect(
      describeCiStatus({
        sha: 'b'.repeat(40),
        overall: 'none',
        counts: { failure: 0, pending: 0, success: 0, neutral: 0 },
        checks: [],
        isTruncated: false,
      }),
    ).toMatchObject({ tone: 'muted', text: 'CI: no checks' });
  });
});
