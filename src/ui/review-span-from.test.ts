import { describe } from 'vitest';

import type { ReviewView } from '#contract/ipc-contract.ts';

import { reviewSpanFrom } from './review-span-from.ts';
import { test } from './testing/test.ts';

describe('reviewSpanFrom', () => {
  test('spans the fork point to the head, or the reviewed head to the head', ({ expect }) => {
    const full = { baseSha: 'b', headSha: 'h', scope: { kind: 'full' } } as ReviewView;
    expect(reviewSpanFrom(full)).toStrictEqual({ from: 'b', to: 'h', title: 'b..h' });
    const interdiff = {
      baseSha: 'b',
      headSha: 'h',
      scope: { kind: 'interdiff', fromHeadSha: 'r' },
    } as ReviewView;
    expect(reviewSpanFrom(interdiff)).toMatchObject({ from: 'r', to: 'h' });
    expect(reviewSpanFrom(undefined)).toBeUndefined();
  });
});
