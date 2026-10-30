import type {
  CreateLocalSessionRequest,
  IpcError,
  SessionSummary,
} from '#contract/ipc-contract.ts';
import { openRepository } from '#internal/git/open-repository.ts';
import { resolveRevision } from '#internal/git/resolve-revision.ts';
import { advanceHead } from '#internal/session/advance-head.ts';
import { createSession } from '#internal/session/create-session.ts';
import { findSessionBySource } from '#internal/session/find-session-by-source.ts';
import { insertSession } from '#internal/session/insert-session.ts';
import type { Session, SessionSource } from '#internal/session/session.ts';
import { updateSessionHead } from '#internal/session/update-session-head.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { gitFailure } from './git-failure.ts';
import type { SessionContext } from './session-context.ts';
import { sessionFailure } from './session-failure.ts';
import { toSessionSummary } from './to-session-summary.ts';

/**
 * Starts reviewing a local branch, or resumes the session that already reviews it (moving its
 * head if the branch moved). Both refs must name commits; `repoPath` may be any directory in the
 * repository, and the session records the repository's top level.
 */
export async function createLocalSession(
  context: SessionContext,
  request: CreateLocalSessionRequest,
): Promise<Result<SessionSummary, IpcError>> {
  const { logger } = context;
  const repository = await openRepository(request.repoPath, context.git);
  if (!repository.ok) {
    return gitFailure(logger, repository.error);
  }
  const base = await resolveRevision(repository.value, request.baseRef);
  if (!base.ok) {
    return gitFailure(logger, base.error);
  }
  const head = await resolveRevision(repository.value, request.headRef);
  if (!head.ok) {
    return gitFailure(logger, head.error);
  }
  const source: SessionSource = {
    kind: 'local',
    repoPath: repository.value.root,
    baseRef: request.baseRef,
    headRef: request.headRef,
  };
  const saved = upsert(context, source, head.value);
  return saved.ok ? ok(toSessionSummary(saved.value)) : saved;
}

function upsert(
  context: SessionContext,
  source: SessionSource,
  headSha: Session['headSha'],
): Result<Session, IpcError> {
  const { db, deps, logger } = context;
  const existing = findSessionBySource(db, source);
  if (!existing.ok) {
    return sessionFailure(logger, existing.error);
  }
  if (existing.value !== undefined) {
    const advanced = advanceHead(existing.value, headSha);
    if (advanced === existing.value) {
      return ok(advanced);
    }
    const updated = updateSessionHead(db, advanced);
    return updated.ok ? ok(advanced) : sessionFailure(logger, updated.error);
  }
  const created = createSession(source, headSha, deps);
  if (!created.ok) {
    return sessionFailure(logger, created.error);
  }
  const inserted = insertSession(db, created.value);
  return inserted.ok ? ok(created.value) : sessionFailure(logger, inserted.error);
}
