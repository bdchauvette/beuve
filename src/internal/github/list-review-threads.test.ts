import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { listReviewThreads } from './list-review-threads.ts';
import type { PullRequestRef } from './pull-request.ts';
import type { FakeResponse } from './testing/create-fake-github.ts';
import { test } from './testing/test.ts';

function ref(): Omit<PullRequestRef, 'host'> {
  return { owner: 'octo-org', repo: 'hello-world', number: 7 };
}

function noValue(): unknown {
  return JSON.parse('null') as unknown;
}

function comment(id: number, fields: Record<string, unknown>): Record<string, unknown> {
  return {
    id,
    path: 'src/a.ts',
    side: 'RIGHT',
    commit_id: 'head',
    original_commit_id: 'first',
    created_at: `2026-10-0${String(id)}T10:00:00Z`,
    html_url: `https://github.com/octo-org/hello-world/pull/7#discussion_r${String(id)}`,
    user: { login: 'rita' },
    body: `comment ${String(id)}`,
    ...fields,
  };
}

function respondTo(): FakeResponse {
  return {
    status: 200,
    body: [
      comment(1, { line: 12, start_line: 10, original_line: 12 }),
      comment(2, {
        in_reply_to_id: 1,
        line: 12,
        original_line: 12,
        user: noValue(),
        body: noValue(),
      }),
      comment(3, { line: noValue(), original_line: 4, side: 'LEFT' }),
      comment(4, { subject_type: 'file', line: noValue(), original_line: noValue() }),
    ],
  };
}

describe('listReviewThreads', () => {
  test('reads the pull request’s review comments and groups them into threads', async ({
    expect,
    fakeGithub,
    signal,
  }) => {
    const { client, requests } = fakeGithub(respondTo);
    const { threads, isTruncated } = okValueFrom(
      await listReviewThreads(client, ref(), { signal }),
    );
    expect(requests.map((request) => request.url)).toStrictEqual([
      'https://api.github.com/repos/octo-org/hello-world/pulls/7/comments?per_page=100',
    ]);
    expect(isTruncated).toBe(false);
    expect(threads.map((thread) => thread.id)).toStrictEqual(['1', '3', '4']);
    expect(threads[0]?.comments).toMatchObject([
      { author: 'rita', body: 'comment 1' },
      { author: 'ghost', body: '' },
    ]);
    expect(threads[1]).toMatchObject({ side: 'base', isOutdated: true, sha: 'first' });
    expect(threads[2]).toMatchObject({ isOutdated: false, sha: 'head' });
  });

  test('cuts a very long body', async ({ expect, fakeGithub, signal }) => {
    const { client } = fakeGithub(() => {
      return { status: 200, body: [comment(1, { line: 1, body: 'x'.repeat(30_000) })] };
    });
    const { threads } = okValueFrom(await listReviewThreads(client, ref(), { signal }));
    expect(threads[0]?.comments[0]?.body).toHaveLength(20_000);
  });

  test('fails the read when GitHub says so, or answers something unexpected', async ({
    expect,
    fakeGithub,
    signal,
  }) => {
    const missing = fakeGithub(() => {
      return { status: 404, body: { message: 'Not Found' } };
    });
    await expect(listReviewThreads(missing.client, ref(), { signal })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'not-found' },
    });
    const odd = fakeGithub(() => {
      return { status: 200, body: [{ id: 'one' }] };
    });
    await expect(listReviewThreads(odd.client, ref(), { signal })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'unexpected-shape' },
    });
  });
});
