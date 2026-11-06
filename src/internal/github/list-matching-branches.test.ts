import { describe } from 'vitest';

import { listMatchingBranches } from './list-matching-branches.ts';
import { test } from './testing/test.ts';

describe('listMatchingBranches', () => {
  test('lists the branches under a prefix, keeping its slash as a path separator', async ({
    expect,
    fakeGithub,
    signal,
  }) => {
    const sha = 'A'.repeat(40);
    const { client, requests } = fakeGithub(() => {
      return {
        status: 200,
        headers: { etag: '"m1"' },
        body: [
          { ref: 'refs/heads/claude/fix', object: { sha, type: 'commit' } },
          { ref: 'refs/heads/claude/odd', object: { sha, type: 'tag' } },
        ],
      };
    });
    await expect(
      listMatchingBranches(client, { owner: 'o', repo: 'r', prefix: 'claude/' }, { signal }),
    ).resolves.toStrictEqual({
      ok: true,
      value: {
        kind: 'modified',
        value: [{ name: 'claude/fix', sha: sha.toLowerCase() }],
        etag: '"m1"',
      },
    });
    expect(requests[0]?.url).toBe(
      'https://api.github.com/repos/o/r/git/matching-refs/heads/claude/',
    );
  });

  test.for([
    [304, undefined, { ok: true, value: { kind: 'not-modified' } }],
    [404, { message: 'Not Found' }, { ok: false, error: { kind: 'not-found' } }],
    [200, { ref: 'x' }, { ok: false, error: { kind: 'unexpected-shape' } }],
  ] as const)(
    'answers HTTP %i',
    async ([status, body, expected], { expect, fakeGithub, signal }) => {
      const { client } = fakeGithub(() => {
        return { status, body };
      });
      await expect(
        listMatchingBranches(
          client,
          { owner: 'o', repo: 'r', prefix: 'claude/' },
          { etag: '"m1"', signal },
        ),
      ).resolves.toMatchObject(expected);
    },
  );
});
