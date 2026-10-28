import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';

import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

import type { PullRequestRef } from './pull-request.ts';
import type { CorruptPullRequestRow, StoredPullRequest } from './stored-pull-request.ts';

type Row = Record<string, SQLOutputValue>;

const states = new Set(['open', 'closed', 'merged']);
const textColumns = [
  'title',
  'body',
  'author',
  'html_url',
  'base_branch',
  'base_sha',
  'head_branch',
  'head_sha',
  'github_updated_at',
  'fetched_at',
] as const;

/** The metadata last stored for `ref`, or `undefined` when beuve never fetched it. */
export function findStoredPullRequest(
  db: DatabaseSync,
  ref: PullRequestRef,
): Result<StoredPullRequest | undefined, CorruptPullRequestRow> {
  const row = db
    .prepare(
      `SELECT * FROM github_pull_requests
        WHERE host = ? AND owner = ? AND repo = ? AND number = ?;`,
    )
    .get(ref.host, ref.owner, ref.repo, ref.number);
  return row === undefined ? ok(undefined) : rowToStoredPullRequest(row, ref);
}

function rowToStoredPullRequest(
  row: Row,
  ref: PullRequestRef,
): Result<StoredPullRequest, CorruptPullRequestRow> {
  const text = (column: (typeof textColumns)[number]): string => {
    const value = row[column];
    return typeof value === 'string' ? value : '';
  };
  const { state, is_draft: isDraft, is_cross_repository: isCrossRepository } = row;
  if (
    typeof state !== 'string' ||
    !states.has(state) ||
    textColumns.some((column) => typeof row[column] !== 'string')
  ) {
    return err({ kind: 'corrupt-row', table: 'github_pull_requests', reason: 'unexpected values' });
  }
  return ok({
    ref,
    title: text('title'),
    body: text('body'),
    state: state as StoredPullRequest['state'],
    isDraft: isDraft === 1,
    author: text('author'),
    htmlUrl: text('html_url'),
    baseBranch: text('base_branch'),
    baseSha: text('base_sha'),
    headBranch: text('head_branch'),
    headSha: text('head_sha'),
    isCrossRepository: isCrossRepository === 1,
    updatedAt: text('github_updated_at'),
    fetchedAt: text('fetched_at'),
  });
}
