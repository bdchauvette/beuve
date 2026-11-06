import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { getRepository } from './get-repository.ts';

describe('getRepository', () => {
  test('reads the canonical name and the default branch', async ({
    expect,
    fakeGithub,
    signal,
  }) => {
    const { client, requests } = fakeGithub(() => {
      return {
        status: 200,
        body: {
          name: 'Hello-World',
          owner: { login: 'Octo-Org' },
          default_branch: 'trunk',
          html_url: 'https://github.com/Octo-Org/Hello-World',
        },
      };
    });
    await expect(
      getRepository(client, { owner: 'octo-org', repo: 'hello-world' }, { signal }),
    ).resolves.toStrictEqual({
      ok: true,
      value: {
        owner: 'Octo-Org',
        repo: 'Hello-World',
        defaultBranch: 'trunk',
        htmlUrl: 'https://github.com/Octo-Org/Hello-World',
      },
    });
    expect(requests[0]?.url).toBe('https://api.github.com/repos/octo-org/hello-world');
  });
});
