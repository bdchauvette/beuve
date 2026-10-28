import { describe, expect, it } from 'vitest';

import { cycleZone } from './cycle-zone.ts';

describe('cycleZone', () => {
  const order = ['intent', 'diff', 'ura'] as const;

  it('steps forward and backward with wrap-around', () => {
    expect(cycleZone(order, 'intent', 1)).toBe('diff');
    expect(cycleZone(order, 'ura', 1)).toBe('intent');
    expect(cycleZone(order, 'intent', -1)).toBe('ura');
  });

  it('falls back to the first zone when the current one is hidden', () => {
    expect(cycleZone(order, 'chat', 1)).toBe('intent');
    expect(cycleZone([], 'chat', 1)).toBe('chat');
  });
});
