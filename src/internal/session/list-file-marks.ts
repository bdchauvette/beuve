import type { DatabaseSync } from 'node:sqlite';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';
import { isIsoTimestamp } from '#x/time/is-iso-timestamp.ts';

import { parseCommitSha } from './parse-commit-sha.ts';
import type { FileMark, SessionError, SessionId } from './session.ts';

const diffIdPattern = /^[\da-f]{64}$/u;

type CorruptRow = Extract<SessionError, { kind: 'corrupt-row' }>;

/** A session's file marks, by path. Rows are validated on the way out. */
export function listFileMarks(
  db: DatabaseSync,
  sessionId: SessionId,
): Result<FileMark[], CorruptRow> {
  const rows = db
    .prepare(
      'SELECT path, diff_id, head_sha, marked_at FROM file_marks WHERE session_id = ? ORDER BY path;',
    )
    .all(sessionId);
  const marks: FileMark[] = [];
  for (const row of rows) {
    const { path, diff_id: diffId, head_sha: headSha, marked_at: markedAt } = row;
    const corrupt = (reason: string): Result<FileMark[], CorruptRow> =>
      err({ kind: 'corrupt-row', table: 'file_marks', id: `${sessionId}/${String(path)}`, reason });
    if (typeof path !== 'string' || path === '') {
      return corrupt('path is not a non-empty string');
    }
    if (typeof diffId !== 'string' || !diffIdPattern.test(diffId)) {
      return corrupt('diff_id is not a SHA-256 digest');
    }
    const head = parseCommitSha(typeof headSha === 'string' ? headSha : '');
    if (!head.ok) {
      return corrupt('head_sha is not a commit id');
    }
    if (typeof markedAt !== 'string' || !isIsoTimestamp(markedAt)) {
      return corrupt('marked_at is not an ISO-8601 UTC timestamp');
    }
    marks.push({ sessionId, path, diffId, headSha: head.value, markedAt });
  }
  return ok(marks);
}
