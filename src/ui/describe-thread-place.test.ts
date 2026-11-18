import { describe } from 'vitest';

import type { ReviewThreadView } from '#contract/ipc-contract.ts';

import { describeThreadPlace } from './describe-thread-place.ts';
import { test } from './testing/test.ts';

function thread(overrides: Partial<ReviewThreadView>): ReviewThreadView {
  return {
    id: '1',
    path: 'a.ts',
    side: 'head',
    sha: 'head',
    isOutdated: false,
    comments: [],
    ...overrides,
  };
}

describe('describeThreadPlace', () => {
  test.for<[Partial<ReviewThreadView>, string]>([
    [{ startLine: 3, endLine: 3 }, 'line 3'],
    [{ startLine: 3, endLine: 4 }, 'lines 3–4'],
    [{ side: 'base', startLine: 3, endLine: 3 }, 'base line 3'],
    [{ side: 'base', startLine: 3, endLine: 6 }, 'base lines 3–6'],
    [{}, 'whole file'],
    [{ isOutdated: true, startLine: 2, endLine: 2 }, 'line 2 (outdated)'],
    [{ isOutdated: true }, 'whole file (outdated)'],
  ])('names %j as %s', ([overrides, expected], { expect }) => {
    expect(describeThreadPlace(thread(overrides))).toBe(expected);
  });
});
