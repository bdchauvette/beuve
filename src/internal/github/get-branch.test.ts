import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { getBranch } from './get-branch.ts';

describe('getBranch', () => {
  test('reads the tip of a nested branch, keeping its slashes as path separators', async ({
    expect,
    fakeGithub,
    signal,
  }) => {
    const sha = 'A'.repeat(40);
    const { client, requests } = fakeGithub(() => {
      return {
        status: 200,
        body: { name: 'claude/fix', commit: { sha } },
        headers: { etag: '"b1"' },
      };
    });
    await expect(
      getBranch(client, { owner: 'o', repo: 'r', branch: 'claude/fix' }, { signal }),
    ).resolves.toStrictEqual({
      ok: true,
      value: {
        kind: 'modified',
        value: { name: 'claude/fix', sha: sha.toLowerCase() },
        etag: '"b1"',
      },
    });
    expect(requests[0]?.url).toBe('https://api.github.com/repos/o/r/branches/claude/fix');
  });

  test.for([
    [304, undefined, { ok: true, value: { kind: 'not-modified' } }],
    [404, { message: 'Branch not found' }, { ok: false, error: { kind: 'not-found' } }],
  ] as const)(
    'answers HTTP %i',
    async ([status, body, expected], { expect, fakeGithub, signal }) => {
      const { client, requests } = fakeGithub(() => {
        return { status, body };
      });
      await expect(
        getBranch(client, { owner: 'o', repo: 'r', branch: 'gone' }, { etag: '"b1"', signal }),
      ).resolves.toMatchObject(expected);
      expect(requests[0]?.headers).toMatchObject({ 'If-None-Match': '"b1"' });
    },
  );

  test('refuses an answer that is not a branch', async ({ expect, fakeGithub, signal }) => {
    const { client } = fakeGithub(() => {
      return { status: 200, body: { name: 'x' } };
    });
    await expect(
      getBranch(client, { owner: 'o', repo: 'r', branch: 'x' }, { signal }),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'unexpected-shape' },
    });
  });
});
