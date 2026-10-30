import { describe, expect, it } from 'vitest';

import { normalizeHostname } from './normalize-hostname.ts';

describe('normalizeHostname', () => {
  it('accepts and lowercases hostnames', () => {
    expect(normalizeHostname('GitHub.com')).toBe('github.com');
    expect(normalizeHostname('ghe-01.corp.example')).toBe('ghe-01.corp.example');
  });

  it('rejects anything that is not a bare hostname', () => {
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
