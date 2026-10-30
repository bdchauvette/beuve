import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { getCiStatus } from './get-ci-status.ts';
import { summarizeCiStatus } from './summarize-ci-status.ts';
import type { FakeResponse, RecordedRequest } from './testing/create-fake-github.ts';
import githubFixtures from './testing/github-fixtures.json' with { type: 'json' };

function commit(): { owner: string; repo: string; sha: string } {
  return { owner: 'octo-org', repo: 'hello-world', sha: githubFixtures.headSha };
}

function ci(request: RecordedRequest): FakeResponse {
  return request.url.includes('/check-runs')
    ? { status: 200, body: githubFixtures.checkRuns, headers: { etag: '"checks-1"' } }
    : { status: 200, body: githubFixtures.combinedStatus, headers: { etag: '"status-1"' } };
}

describe('getCiStatus', () => {
  test('merges check runs and statuses into one rollup', async ({ expect, fakeGithub, signal }) => {
    const { client, requests } = fakeGithub(ci);
    const result = await getCiStatus(client, commit(), { signal });
    expect(
      requests.map((request) => request.url).toSorted((a, b) => a.localeCompare(b)),
    ).toStrictEqual([
      `https://api.github.com/repos/octo-org/hello-world/commits/${githubFixtures.headSha}/check-runs?per_page=100`,
      `https://api.github.com/repos/octo-org/hello-world/commits/${githubFixtures.headSha}/status?per_page=100`,
    ]);
    expect(result.ok && result.value.kind === 'modified' && result.value).toMatchObject({
      etags: { statuses: '"status-1"', checkRuns: '"checks-1"' },
      value: {
        sha: githubFixtures.headSha,
        isTruncated: false,
        rollup: { overall: 'failure', counts: { failure: 1, neutral: 1, pending: 2, success: 1 } },
        checks: [
          {
            source: 'check-run',
            name: 'test',
            status: 'completed',
            conclusion: 'failure',
            bucket: 'failure',
            url: 'https://github.com/octo-org/hello-world/runs/4',
            startedAt: '2026-10-01T16:00:10Z',
            completedAt: '2026-10-01T16:03:10Z',
          },
          { name: 'lint', bucket: 'neutral', conclusion: 'skipped' },
          {
            name: 'e2e',
            status: 'in-progress',
            bucket: 'pending',
            conclusion: undefined,
            completedAt: undefined,
          },
          {
            source: 'status',
            name: 'continuous-integration/jenkins',
            bucket: 'success',
            conclusion: 'success',
          },
          {
            source: 'status',
            name: 'deploy/preview',
            bucket: 'pending',
            status: 'queued',
            url: undefined,
          },
        ],
      },
    });
  });

  test('is not-modified when both endpoints answer 304', async ({ expect, fakeGithub, signal }) => {
    const { client, requests } = fakeGithub(() => ({ status: 304 }));
    const result = await getCiStatus(client, commit(), {
      etags: { statuses: '"status-1"', checkRuns: '"checks-1"' },
      signal,
    });
    expect(result).toStrictEqual({ ok: true, value: { kind: 'not-modified' } });
    expect(
      requests
        .map((request) => request.headers['If-None-Match'] ?? '')
        .toSorted((a, b) => a.localeCompare(b)),
    ).toStrictEqual(['"checks-1"', '"status-1"']);
  });

  test('refetches both when one of them changed', async ({ expect, fakeGithub, signal }) => {
    const { client, requests } = fakeGithub((request, index) =>
      index < 2 && request.url.includes('/status') ? { status: 304 } : ci(request),
    );
    const result = await getCiStatus(client, commit(), {
      etags: { statuses: '"status-1"', checkRuns: '"checks-0"' },
      signal,
    });
    expect(result).toMatchObject({ ok: true, value: { kind: 'modified' } });
    expect(requests).toHaveLength(4);
  });

  test('drops the check-runs ETag when they span pages', async ({ expect, fakeGithub, signal }) => {
    const page2 = `https://api.github.com/repositories/1/commits/${githubFixtures.headSha}/check-runs?page=2`;
    const { client } = fakeGithub((request) =>
      request.url === page2
        ? {
            status: 200,
            body: { total_count: 4, check_runs: [githubFixtures.checkRuns.check_runs[0]] },
          }
        : request.url.includes('/check-runs')
          ? {
              status: 200,
              body: githubFixtures.checkRuns,
              headers: { etag: '"c"', link: `<${page2}>; rel="next"` },
            }
          : ci(request),
    );
    const result = await getCiStatus(client, commit(), { signal });
    expect(
      result.ok && result.value.kind === 'modified' && result.value.etags.checkRuns,
    ).toBeUndefined();
    expect(result.ok && result.value.kind === 'modified' && result.value.value.checks).toHaveLength(
      6,
    );
  });
});

describe('summarizeCiStatus', () => {
  test('prefers failure, then pending, then success, then neutral', ({ expect }) => {
    expect(summarizeCiStatus([])).toStrictEqual({
      overall: 'none',
      counts: { pending: 0, success: 0, failure: 0, neutral: 0 },
    });
    const check = (
      bucket: 'pending' | 'success' | 'failure' | 'neutral',
    ): Parameters<typeof summarizeCiStatus>[0][number] => ({
      source: 'check-run',
      name: bucket,
      status: 'completed',
      conclusion: bucket,
      bucket,
      url: undefined,
      startedAt: undefined,
      completedAt: undefined,
    });
    expect(summarizeCiStatus([check('neutral')]).overall).toBe('neutral');
    expect(summarizeCiStatus([check('neutral'), check('success')]).overall).toBe('success');
    expect(summarizeCiStatus([check('success'), check('pending')]).overall).toBe('pending');
    expect(summarizeCiStatus([check('pending'), check('failure')]).overall).toBe('failure');
  });
});
