import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { parseGhAuthStatus } from './parse-gh-auth-status.ts';

/** Shapes captured from gh 2.89 with a throwaway config (the error entry names a fake host). */
function failedCheck(): string {
  return JSON.stringify({
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
}

describe('parseGhAuthStatus', () => {
  test('reads the active account and its scopes', ({ expect }) => {
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
    expect(parseGhAuthStatus({ stdout: stdout, host: 'github.com' })).toStrictEqual({
      login: 'octocat',
      scopes: ['gist', 'read:org', 'repo'],
      check: { kind: 'valid' },
    });
  });

  test('reports a failed check with gh’s reason', ({ expect }) => {
    expect(parseGhAuthStatus({ stdout: failedCheck(), host: 'ghe.invalid' })).toStrictEqual({
      login: 'fakeuser',
      scopes: undefined,
      check: {
        kind: 'failed',
        message: 'Get "https://ghe.invalid/api/v3/": dial tcp: lookup ghe.invalid: no such host',
      },
    });
  });

  test('has no account for a host gh does not list', ({ expect }) => {
    expect(parseGhAuthStatus({ stdout: '{"hosts":{}}', host: 'github.com' })).toBeUndefined();
  });

  test('rejects output of another shape', ({ expect }) => {
    expect(parseGhAuthStatus({ stdout: 'not json', host: 'github.com' })).toBe('invalid');
    expect(parseGhAuthStatus({ stdout: '{"hosts":[]}', host: 'github.com' })).toBe('invalid');
  });
});
