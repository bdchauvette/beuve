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

  test('reads the parent and the source of a fork', async ({ expect, fakeGithub, signal }) => {
    const { client } = fakeGithub(() => {
      return {
        status: 200,
        body: {
          name: 'hello-world',
          owner: { login: 'forker' },
          default_branch: 'main',
          html_url: 'https://github.com/forker/hello-world',
          fork: true,
          parent: { name: 'hello-world', owner: { login: 'mid' }, default_branch: 'dev' },
          source: { name: 'Hello-World', owner: { login: 'Octo-Org' }, default_branch: 'trunk' },
        },
      };
    });
    await expect(
      getRepository(client, { owner: 'forker', repo: 'hello-world' }, { signal }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        owner: 'forker',
        parent: { owner: 'mid', repo: 'hello-world', defaultBranch: 'dev' },
        source: { owner: 'Octo-Org', repo: 'Hello-World', defaultBranch: 'trunk' },
      },
    });
  });
});
