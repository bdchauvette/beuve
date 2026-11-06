import type { IpcError } from '#contract/ipc-contract.ts';
import { createSession } from '#internal/session/create-session.ts';
import { findSessionBySource } from '#internal/session/find-session-by-source.ts';
import { insertSession } from '#internal/session/insert-session.ts';
import type { CommitSha, Session, SessionSource } from '#internal/session/session.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { SessionContext } from '../sessions/session-context.ts';
import { sessionFailure } from '../sessions/session-failure.ts';

import { moveSessionHead } from './move-session-head.ts';

/** A pull request's session source, the head just fetched, and the session as first observed. */
export interface PullRequestHead {
  readonly source: Extract<SessionSource, { kind: 'github-pull-request' }>;
  readonly headSha: CommitSha;
  readonly observedFrom: Session | undefined;
}

/**
 * Resumes the session reviewing `source` (found with `findSessionBySource`, so opening a pull
 * request twice is one session) or creates it. A moved head is stored and announced through
 * `onHeadMoved`, which aborts work for the old head and re-anchors URA items.
 *
 * `observedFrom` is the session as it was when the caller started observing the head (before its
 * fetch): if another writer, such as the poller, moved the head since, that newer write stands
 * and the session comes back as stored (ADR 0079).
 */
export function upsertPullRequestSession(
  context: SessionContext,
  { source, headSha, observedFrom }: PullRequestHead,
): Result<Session, IpcError> {
  const { db, deps, logger } = context;
  const existing = findSessionBySource(db, source);
  if (!existing.ok) {
    return sessionFailure(logger, existing.error);
  }
  if (existing.value === undefined) {
    const created = createSession(source, headSha, deps);
    if (!created.ok) {
      return sessionFailure(logger, created.error);
    }
    const inserted = insertSession(db, created.value);
    if (inserted.ok) {
      return ok(created.value);
    }
    return sessionFailure(logger, inserted.error);
  }
  const moved = moveSessionHead(context, observedFrom ?? existing.value, headSha);
  if (!moved.ok && moved.error.code === 'stale-review') {
    return ok(existing.value);
  }
  return moved;
}
