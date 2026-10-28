import { describe, expect, it } from 'vitest';

import { isVersionAtLeast } from './is-version-at-least.ts';

const version = { major: 2, minor: 39, patch: 3, raw: '' };

describe('isVersionAtLeast', () => {
  it('compares major then minor', () => {
    expect(isVersionAtLeast(version, 2, 38)).toBe(true);
    expect(isVersionAtLeast(version, 2, 39)).toBe(true);
    expect(isVersionAtLeast(version, 2, 40)).toBe(false);
    expect(isVersionAtLeast(version, 1, 99)).toBe(true);
    expect(isVersionAtLeast({ ...version, major: 3, minor: 0 }, 2, 40)).toBe(true);
  });
});
