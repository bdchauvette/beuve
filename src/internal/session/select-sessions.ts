import type { DatabaseSync, SQLInputValue, SQLOutputValue } from 'node:sqlite';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { isIsoTimestamp } from '#x/time/is-iso-timestamp.ts';
import { isUuid } from '#x/text/is-uuid.ts';
import { parseCommitSha } from './parse-commit-sha.ts';
import { parseSessionSource } from './parse-session-source.ts';
import { checkpointFromRow } from './checkpoint-from-row.ts';
import type { ReviewState, Session, SessionError, SessionId, SessionSource } from './session.ts';

type CorruptRow = Extract<SessionError, { kind: 'corrupt-row' }>;
type Row = Record<string, SQLOutputValue>;

/**
 * Loads sessions matching `where` (a trusted SQL condition over alias `s`; values go in
 * `parameters`), newest activity first, each with its review state derived from its latest
 * checkpoint. Internal to the session domain.
 */
export function selectSessions(
  db: DatabaseSync,
  where: string,
  parameters: readonly SQLInputValue[] = [],
): Result<Session[], CorruptRow> {
  const rows = db
    .prepare(
      `SELECT s.id, s.kind, s.repo_path, s.base_ref, s.head_ref, s.host, s.owner, s.repo, s.pr_number,
              s.head_sha, s.created_at, s.updated_at,
              c.id AS checkpoint_id, c.session_id AS checkpoint_session_id,
              c.base_sha AS checkpoint_base_sha, c.head_sha AS checkpoint_head_sha,
              c.created_at AS checkpoint_created_at
         FROM sessions AS s
         LEFT JOIN checkpoints AS c ON c.id = (
           SELECT id FROM checkpoints WHERE session_id = s.id
            ORDER BY created_at DESC, rowid DESC LIMIT 1)
        WHERE ${where}
        ORDER BY s.updated_at DESC, s.id;`,
    )
    .all(...parameters);

  const sessions: Session[] = [];
  for (const row of rows) {
    const session = sessionFromRow(row);
    if (!session.ok) {
      return session;
    }
    sessions.push(session.value);
  }
  return ok(sessions);
}

function sessionFromRow(row: Row): Result<Session, CorruptRow> {
  const { id, head_sha: headSha, created_at: createdAt, updated_at: updatedAt } = row;
  const corrupt = (reason: string): Result<Session, CorruptRow> =>
    err({ kind: 'corrupt-row', table: 'sessions', id: String(id), reason });

  if (typeof id !== 'string' || !isUuid(id)) {
    return corrupt('id is not a UUID');
  }
  const source = sourceFromRow(row);
  if (typeof source === 'string') {
    return corrupt(source);
  }
  const sha = parseCommitSha(typeof headSha === 'string' ? headSha : '');
  if (!sha.ok) {
    return corrupt('head_sha is not a commit id');
  }
  if (typeof createdAt !== 'string' || !isIsoTimestamp(createdAt)) {
    return corrupt('created_at is not an ISO-8601 UTC timestamp');
  }
  if (typeof updatedAt !== 'string' || !isIsoTimestamp(updatedAt)) {
    return corrupt('updated_at is not an ISO-8601 UTC timestamp');
  }
  const review = reviewFromRow(row);
  if (!review.ok) {
    return review;
  }
  return ok({
    id: id as SessionId,
    source,
    headSha: sha.value,
    review: review.value,
    createdAt,
    updatedAt,
  });
}

function sourceFromRow(row: Row): SessionSource | string {
  const { kind, repo_path: repoPath, base_ref: baseRef, head_ref: headRef } = row;
  const { host, owner, repo, pr_number: number } = row;
  if (typeof repoPath !== 'string' || typeof baseRef !== 'string') {
    return 'repo_path and base_ref must be text';
  }
  let source: SessionSource;
  if (
    kind === 'local' &&
    typeof headRef === 'string' &&
    host === null &&
    owner === null &&
    repo === null &&
    number === null
  ) {
    source = { kind, repoPath, baseRef, headRef };
  } else if (
    kind === 'github-pull-request' &&
    headRef === null &&
    typeof host === 'string' &&
    typeof owner === 'string' &&
    typeof repo === 'string' &&
    typeof number === 'number'
  ) {
    source = { kind, repoPath, baseRef, host, owner, repo, number };
  } else {
    return 'kind and source columns disagree';
  }
  const parsed = parseSessionSource(source);
  return parsed.ok ? parsed.value : parsed.error.reason;
}

function reviewFromRow(row: Row): Result<ReviewState, CorruptRow> {
  if (row['checkpoint_id'] === null) {
    return ok({ kind: 'unreviewed' });
  }
  const checkpoint = checkpointFromRow(row);
  return checkpoint.ok ? ok({ kind: 'reviewed', checkpoint: checkpoint.value }) : checkpoint;
}
