import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { buildGithubRemoteUrl } from './build-github-remote-url.ts';
import { buildPullRequestFetch } from './build-pull-request-fetch.ts';

describe('buildPullRequestFetch', () => {
  test('fetches the pull request head (and optionally its base) under refs/beuve/', ({
    expect,
  }) => {
    const remote = buildGithubRemoteUrl({
      host: 'github.com',
      owner: 'octo-org',
      repo: 'hello-world',
    });
    expect(remote).toBe('https://github.com/octo-org/hello-world.git');
    expect(
      buildPullRequestFetch({ number: 1347, remote, baseBranch: 'release/2.x' }),
    ).toStrictEqual({
      ok: true,
      value: {
        args: [
          'fetch',
          '--no-tags',
          '--no-write-fetch-head',
          '--end-of-options',
          'https://github.com/octo-org/hello-world.git',
          '+refs/pull/1347/head:refs/beuve/pr/1347/head',
          '+refs/heads/release/2.x:refs/beuve/pr/1347/base',
        ],
        headRef: 'refs/beuve/pr/1347/head',
        baseRef: 'refs/beuve/pr/1347/base',
      },
    });
    expect(buildPullRequestFetch({ number: 2, remote: 'origin' })).toMatchObject({
      ok: true,
      value: {
        baseRef: undefined,
        args: [
          'fetch',
          '--no-tags',
          '--no-write-fetch-head',
          '--end-of-options',
          'origin',
          '+refs/pull/2/head:refs/beuve/pr/2/head',
        ],
      },
    });
  });

  test('refuses unsafe numbers, remotes and branch names', ({ expect }) => {
    expect(buildPullRequestFetch({ number: 0, remote: 'origin' }).ok).toBe(false);
    expect(buildPullRequestFetch({ number: 1.5, remote: 'origin' }).ok).toBe(false);
    for (const remote of [
      '--upload-pack=x',
      'ext::sh',
      'https://x:tok@github.com/o/r.git',
      'file:///tmp/r',
      '',
    ]) {
      expect({ remote, ok: buildPullRequestFetch({ number: 1, remote }).ok }).toStrictEqual({
        remote,
        ok: false,
      });
    }
    for (const baseBranch of [
      '-x',
      'a..b',
      'a:b',
      'x.lock',
      '.hidden',
      'a/.b',
      'a b',
      'a/',
      'x~1',
    ]) {
      const { ok } = buildPullRequestFetch({ number: 1, remote: 'origin', baseBranch });
      expect({ baseBranch, ok }).toStrictEqual({ baseBranch, ok: false });
    }
  });
});
