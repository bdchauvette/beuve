import { describe, expect, it } from 'vitest';

import { openDatabase } from '#sqlite/open-database.ts';
import { runMigrations } from '#sqlite/run-migrations.ts';

import { decodeWith } from './decode-with.ts';
import { findStoredPullRequest } from './find-stored-pull-request.ts';
import { githubMigrations } from './github-migrations.ts';
import type { PullRequest } from './pull-request.ts';
import { pullRequestSchema } from './pull-request-schema.ts';
import { savePullRequest } from './save-pull-request.ts';
import fixtures from './testing/github-fixtures.json' with { type: 'json' };

const ref = { host: 'github.com', owner: 'octo-org', repo: 'hello-world', number: 1347 };

describe('savePullRequest', () => {
  it('stores, replaces and reads back pull request metadata', () => {
    const db = openDatabase(':memory:');
    expect(runMigrations(db, githubMigrations)).toEqual(['github-0001-initial']);
    expect(findStoredPullRequest(db, ref)).toEqual({ ok: true, value: undefined });

    const decoded = decodeWith(pullRequestSchema, fixtures.pullRequest);
    if (!decoded.ok) {
      throw new Error(decoded.error);
    }
    const pullRequest: PullRequest = decoded.value;
    savePullRequest(db, ref, pullRequest, Temporal.Instant.from('2026-10-28T12:00:00.000Z'));
    savePullRequest(
      db,
      ref,
      { ...pullRequest, title: 'Renamed', isDraft: true, state: 'merged' },
      Temporal.Instant.from('2026-10-28T13:00:00.000Z'),
    );
    expect(findStoredPullRequest(db, ref)).toEqual({
      ok: true,
      value: {
        ref,
        title: 'Renamed',
        body: pullRequest.body,
        state: 'merged',
        isDraft: true,
        author: 'octocat',
        htmlUrl: 'https://github.com/octo-org/hello-world/pull/1347',
        baseBranch: 'main',
        baseSha: fixtures.baseSha,
        headBranch: 'new-topic',
        headSha: fixtures.headSha,
        isCrossRepository: true,
        updatedAt: pullRequest.updatedAt,
        fetchedAt: '2026-10-28T13:00:00.000Z',
      },
    });
    expect(findStoredPullRequest(db, { ...ref, host: 'ghe.example.com' })).toEqual({
      ok: true,
      value: undefined,
    });
  });
});
