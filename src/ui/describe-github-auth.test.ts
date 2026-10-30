import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { describeGithubAuth } from './describe-github-auth.ts';

describe('describeGithubAuth', () => {
  test('names the login and mechanism', ({ expect }) => {
    expect(
      describeGithubAuth({
        kind: 'signed-in',
        host: 'github.com',
        provider: 'gh-cli',
        login: 'octocat',
        scopes: ['repo', 'read:org'],
      }),
    ).toStrictEqual({
      tone: 'ok',
      text: 'GitHub: @octocat via gh',
      title: 'github.com\nScopes: repo, read:org',
    });
  });

  test('tells a signed-out reviewer what to run', ({ expect }) => {
    expect(
      describeGithubAuth({
        kind: 'signed-out',
        host: 'github.com',
        reason: 'not-logged-in',
        message: 'Not signed in.',
        remedy: 'gh auth login --hostname github.com',
      }),
    ).toStrictEqual({
      tone: 'warn',
      text: 'GitHub: not signed in — run gh auth login',
      title: 'Run: gh auth login --hostname github.com',
    });
    expect(
      describeGithubAuth({
        kind: 'signed-out',
        host: 'github.com',
        reason: 'cli-not-installed',
        message: 'Install gh.',
      }).text,
    ).toBe('GitHub: gh not installed');
  });
});
