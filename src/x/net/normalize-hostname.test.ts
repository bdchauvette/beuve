import { describe } from 'vitest';

import { normalizeHostname } from './normalize-hostname.ts';
import { test } from '#testing/test.ts';

describe('normalizeHostname', () => {
  test('accepts and lowercases hostnames', ({ expect }) => {
    expect(normalizeHostname('GitHub.com')).toBe('github.com');
    expect(normalizeHostname('ghe-01.corp.example')).toBe('ghe-01.corp.example');
  });

  test('rejects anything that is not a bare hostname', ({ expect }) => {
    for (const host of [
      '',
      '-h',
      'https://github.com',
      'github.com:443',
      'a..b',
      'a_b.com',
      'a b',
    ]) {
      expect(normalizeHostname(host)).toBeUndefined();
    }
  });
});
