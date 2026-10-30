import { describe, expect, it } from 'vitest';

import { isCalverTag } from './is-calver-tag.ts';

describe('isCalverTag', () => {
  it.each(['v2026.10.1', 'v2026.1.1', 'v2027.12.34'])('accepts %s', (tag) => {
    expect(isCalverTag(tag)).toBe(true);
  });

  it.each([
    'v2026.10',
    'v2026.10.0',
    'v2026.13.1',
    'v2026.0.1',
    'v2026.01.1',
    'v2026.10.01',
    'v26.10.1',
    'v2026.10.1-dev.abc1234',
    'v2026.10.1+2',
    '2026.10.1',
    'v0.1.0',
    'v2026.10.1.1',
    'v2026.10.1\n',
  ])('rejects %j', (tag) => {
    expect(isCalverTag(tag)).toBe(false);
  });
});
