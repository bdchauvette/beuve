import type { SQLOutputValue } from 'node:sqlite';

import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

import { isIsoTimestamp } from './is-iso-timestamp.ts';
import { isUuid } from './is-uuid.ts';
import { parseCommitSha } from './parse-commit-sha.ts';
import type { Checkpoint, CheckpointId, SessionError, SessionId } from './session.ts';

type CorruptRow = Extract<SessionError, { kind: 'corrupt-row' }>;

/**
 * Validates a checkpoint row selected with `checkpoint_`-prefixed columns
 * (`checkpoint_id`, `checkpoint_session_id`, `checkpoint_commit_sha`, `checkpoint_created_at`).
 */
export function rowToCheckpoint(
  row: Record<string, SQLOutputValue>,
): Result<Checkpoint, CorruptRow> {
  const id = row['checkpoint_id'];
  const sessionId = row['checkpoint_session_id'];
  const commitSha = row['checkpoint_commit_sha'];
  const createdAt = row['checkpoint_created_at'];
  const corrupt = (reason: string): Result<Checkpoint, CorruptRow> =>
    err({ kind: 'corrupt-row', table: 'checkpoints', id: String(id), reason });

  if (typeof id !== 'string' || !isUuid(id)) {
    return corrupt('id is not a UUID');
  }
  if (typeof sessionId !== 'string' || !isUuid(sessionId)) {
    return corrupt('session_id is not a UUID');
  }
  const sha = parseCommitSha(typeof commitSha === 'string' ? commitSha : '');
  if (!sha.ok) {
    return corrupt('commit_sha is not a commit id');
  }
  if (typeof createdAt !== 'string' || !isIsoTimestamp(createdAt)) {
    return corrupt('created_at is not an ISO-8601 UTC timestamp');
  }
  return ok({
    id: id as CheckpointId,
    sessionId: sessionId as SessionId,
    commitSha: sha.value,
    createdAt,
  });
}
