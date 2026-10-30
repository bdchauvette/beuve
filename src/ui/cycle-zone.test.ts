import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { cycleZone } from './cycle-zone.ts';

describe('cycleZone', () => {
  const order = ['intent', 'diff', 'ura'] as const;

  test('steps forward and backward with wrap-around', ({ expect }) => {
    expect(cycleZone(order, 'intent', 1)).toBe('diff');
    expect(cycleZone(order, 'ura', 1)).toBe('intent');
    expect(cycleZone(order, 'intent', -1)).toBe('ura');
  });

  test('falls back to the first zone when the current one is hidden', ({ expect }) => {
    expect(cycleZone(order, 'chat', 1)).toBe('intent');
    expect(cycleZone([], 'chat', 1)).toBe('chat');
  });
});
