import { describe, expect, it } from 'vitest';

import { parseGhAuthStatus } from './parse-gh-auth-status.ts';

/** Shapes captured from gh 2.89 with a throwaway config (the error entry names a fake host). */
const failedCheck = JSON.stringify({
  hosts: {
    'ghe.invalid': [
      {
        state: 'error',
        error: 'Get "https://ghe.invalid/api/v3/": dial tcp: lookup ghe.invalid: no such host',
        active: true,
        host: 'ghe.invalid',
        login: 'fakeuser',
        tokenSource: '/home/u/.config/gh/hosts.yml',
        gitProtocol: 'https',
      },
    ],
  },
});

describe('parseGhAuthStatus', () => {
  it('reads the active account and its scopes', () => {
    const stdout = JSON.stringify({
      hosts: {
        'github.com': [
          { state: 'success', active: false, host: 'github.com', login: 'work', scopes: 'repo' },
          {
            state: 'success',
            active: true,
            host: 'github.com',
            login: 'octocat',
            scopes: 'gist, read:org, repo',
            token: 'gho_never_surfaced',
          },
        ],
      },
    });
    expect(parseGhAuthStatus(stdout, 'github.com')).toEqual({
      login: 'octocat',
      scopes: ['gist', 'read:org', 'repo'],
      check: { kind: 'valid' },
    });
  });

  it('reports a failed check with gh’s reason', () => {
    expect(parseGhAuthStatus(failedCheck, 'ghe.invalid')).toEqual({
      login: 'fakeuser',
      scopes: undefined,
      check: {
        kind: 'failed',
        message: 'Get "https://ghe.invalid/api/v3/": dial tcp: lookup ghe.invalid: no such host',
      },
    });
  });

  it('has no account for a host gh does not list', () => {
    expect(parseGhAuthStatus('{"hosts":{}}', 'github.com')).toBeUndefined();
  });

  it('rejects output of another shape', () => {
    expect(parseGhAuthStatus('not json', 'github.com')).toBe('invalid');
    expect(parseGhAuthStatus('{"hosts":[]}', 'github.com')).toBe('invalid');
  });
});
