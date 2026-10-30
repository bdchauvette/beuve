import type { IpcError } from '#contract/ipc-contract.ts';
import type { CommitSha } from '#internal/git/object-id.ts';
import { openRepository } from '#internal/git/open-repository.ts';
import type { GitRepository } from '#internal/git/open-repository.ts';
import { resolveRevision } from '#internal/git/resolve-revision.ts';
import { advanceHead } from '#internal/session/advance-head.ts';
import type { Session } from '#internal/session/session.ts';
import { updateSessionHead } from '#internal/session/update-session-head.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { gitFailure } from './git-failure.ts';
import type { SessionContext } from './session-context.ts';
import { sessionFailure } from './session-failure.ts';

/** A session brought up to date with its repository. */
export interface RefreshedSession {
  readonly session: Session;
  readonly repository: GitRepository;
  /** The commit the session's base ref names right now. */
  readonly baseTip: CommitSha;
}

/** How {@link refreshSession} treats the head. */
export interface RefreshSessionOptions {
  /**
   * The head this operation uses, which the caller already checked against the session (ADR
   * 0078): the session comes back at this head, and its head ref is not read again.
   */
  readonly headSha?: CommitSha;
}

/**
 * Opens the session's repository, resolves its base ref and, for local sessions, its head ref,
 * and persists the head if it moved, telling `context.onHeadMoved`. Pull-request heads keep the
 * stored head here: the GitHub poller fetches, verifies and moves them (ADR 0038). With
 * `options.headSha`, that head is used instead and nothing is persisted.
 */
export async function refreshSession(
  context: SessionContext,
  session: Session,
  options: RefreshSessionOptions = {},
): Promise<Result<RefreshedSession, IpcError>> {
  const { logger } = context;
  const repository = await openRepository(session.source.repoPath, context.git);
  if (!repository.ok) {
    return gitFailure(logger, repository.error);
  }
  const baseTip = await resolveRevision(repository.value, session.source.baseRef);
  if (!baseTip.ok) {
    return gitFailure(logger, baseTip.error);
  }
  if (options.headSha !== undefined) {
    const pinned = { ...session, headSha: options.headSha };
    return ok({ session: pinned, repository: repository.value, baseTip: baseTip.value });
  }
  if (session.source.kind !== 'local') {
    return ok({ session, repository: repository.value, baseTip: baseTip.value });
  }
  const head = await resolveRevision(repository.value, session.source.headRef);
  if (!head.ok) {
    return gitFailure(logger, head.error);
  }
  const advanced = advanceHead(session, head.value);
  if (advanced !== session) {
    const saved = updateSessionHead(context.db, advanced);
    if (!saved.ok) {
      return sessionFailure(logger, saved.error);
    }
    context.onHeadMoved?.(advanced.id, advanced.headSha);
  }
  return ok({ session: advanced, repository: repository.value, baseTip: baseTip.value });
}
