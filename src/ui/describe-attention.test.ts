import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { describeAttention } from './describe-attention.ts';

describe('describeAttention', () => {
  test('names whose turn it is with the reasons on hover', ({ expect }) => {
    expect(
      describeAttention({ turn: 'you', reasons: ['Your review was requested.', 'CI passes.'] }),
    ).toStrictEqual({
      text: 'Your turn',
      title: 'Your review was requested.\nCI passes.\nA heuristic from reviews, requests and CI.',
      isYours: true,
    });
    expect(describeAttention({ turn: 'author', reasons: [] })?.text).toBe('Author’s turn');
    expect(describeAttention({ turn: 'reviewers', reasons: [] })?.isYours).toBe(false);
  });

  test('shows nothing for an unknown turn or before the reviews were read', ({ expect }) => {
    expect(describeAttention({ turn: 'unknown', reasons: ['Merged.'] })).toBeUndefined();
    expect(describeAttention(undefined)).toBeUndefined();
  });
});
