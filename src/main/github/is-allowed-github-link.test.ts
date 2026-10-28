import { describe, expect, it } from 'vitest';

import { isAllowedGithubLink } from './is-allowed-github-link.ts';

describe('isAllowedGithubLink', () => {
  const hosts = new Set(['github.com', 'ghe.example.com']);

  it('allows plain https links on known GitHub hosts', () => {
    expect(isAllowedGithubLink('https://github.com/o/r/issues/1', hosts)).toBe(true);
    expect(isAllowedGithubLink('https://GHE.example.com/o/r/pull/2#x', hosts)).toBe(true);
  });

  it.each([
    // eslint-disable-next-line unicorn/prefer-https -- plain http must be refused.
    'http://github.com/o/r',
    'https://github.com.evil.example/o/r',
    'https://user:pass@github.com/o/r',
    'https://github.com:8443/o/r',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'not a url',
  ])('refuses %s', (url) => {
    expect(isAllowedGithubLink(url, hosts)).toBe(false);
  });
});
