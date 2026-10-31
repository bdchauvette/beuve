import { describe } from 'vitest';

import { isVersionAtLeast } from './is-version-at-least.ts';
import type { GitVersion } from './parse-git-version.ts';
import { test } from './testing/test.ts';

describe('isVersionAtLeast', () => {
  test('compares major then minor', ({ expect }) => {
    expect(isVersionAtLeast(version(), { major: 2, minor: 38 })).toBe(true);
    expect(isVersionAtLeast(version(), { major: 2, minor: 39 })).toBe(true);
    expect(isVersionAtLeast(version(), { major: 2, minor: 40 })).toBe(false);
    expect(isVersionAtLeast(version(), { major: 1, minor: 99 })).toBe(true);
    expect(isVersionAtLeast({ ...version(), major: 3, minor: 0 }, { major: 2, minor: 40 })).toBe(
      true,
    );
  });
});

function version(): GitVersion {
  return { major: 2, minor: 39, patch: 3, raw: '' };
}
