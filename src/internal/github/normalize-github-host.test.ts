import { describe, expect, it } from 'vitest';

import { normalizeGithubHost } from './normalize-github-host.ts';

describe('normalizeGithubHost', () => {
  it('accepts and lowercases hostnames', () => {
    expect(normalizeGithubHost('GitHub.com')).toBe('github.com');
    expect(normalizeGithubHost('ghe-01.corp.example')).toBe('ghe-01.corp.example');
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
      expect(normalizeGithubHost(host)).toBeUndefined();
    }
  });
});
