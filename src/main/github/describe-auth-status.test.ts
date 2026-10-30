import { describe } from 'vitest';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';

import { describeAuthStatus } from './describe-auth-status.ts';
import { test } from '../testing/test.ts';

describe('describeAuthStatus', () => {
  test('names the login, provider and scopes, and a failed check', ({ expect }) => {
    expect(
      describeAuthStatus(
        'github.com',
        ok({
          provider: 'gh-cli',
          host: 'github.com',
          account: { login: 'octocat', scopes: ['repo'], check: { kind: 'valid' } },
        }),
      ),
    ).toStrictEqual({
      kind: 'signed-in',
      host: 'github.com',
      provider: 'gh-cli',
      login: 'octocat',
      scopes: ['repo'],
    });
    expect(
      describeAuthStatus(
        'github.com',
        ok({
          provider: 'gh-cli',
          host: 'github.com',
          account: {
            login: 'octocat',
            scopes: undefined,
            check: { kind: 'failed', message: 'expired' },
          },
        }),
      ),
    ).toMatchObject({ kind: 'signed-in', login: 'octocat', problem: 'expired' });
    expect(
      describeAuthStatus(
        'github.com',
        ok({ provider: 'gh-cli', host: 'github.com', account: undefined }),
      ),
    ).toStrictEqual({ kind: 'signed-in', host: 'github.com', provider: 'gh-cli' });
  });

  test('gives the reason and remedy of a missing credential', ({ expect }) => {
    const remedy = 'gh auth login --hostname github.com';
    expect(
      describeAuthStatus('github.com', err({ kind: 'not-logged-in', host: 'github.com', remedy })),
    ).toStrictEqual({
      kind: 'signed-out',
      host: 'github.com',
      reason: 'not-logged-in',
      message: `Not signed in to github.com. Run \`${remedy}\`.`,
      remedy,
    });
    expect(
      describeAuthStatus(
        'github.com',
        err({ kind: 'cli-not-installed', searched: ['/usr/bin/gh'] }),
      ),
    ).toMatchObject({ kind: 'signed-out', reason: 'cli-not-installed' });
    const timeout = Temporal.Duration.from({ seconds: 10 });
    expect(
      describeAuthStatus('ghe.example.com', err({ kind: 'timeout', timeout }), 'en'),
    ).toMatchObject({
      reason: 'timeout',
      message: 'gh did not answer within 10s.',
    });
  });
});
