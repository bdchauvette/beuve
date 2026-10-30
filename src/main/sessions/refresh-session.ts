import type { IpcError } from '#contract/ipc-contract.ts';
import type { GitError } from '#internal/git/git-error.ts';
import type { CommitSha } from '#internal/git/object-id.ts';
import type { GitRepository } from '#internal/git/open-repository.ts';
import { resolveRevision } from '#internal/git/resolve-revision.ts';
import { advanceHead } from '#internal/session/advance-head.ts';
import type { Session } from '#internal/session/session.ts';
import { updateSessionHead } from '#internal/session/update-session-head.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { gitFailure } from './git-failure.ts';
import { loadSession } from './load-session.ts';
import { openSessionRepository } from './open-session-repository.ts';
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
  /**
   * The base tip this operation uses, which an earlier step of it resolved (ADR 0079): the base
   * ref is not read again, so a base fetched meanwhile can't change the fork point mid-operation.
   */
  readonly baseTip?: CommitSha;
  /** Bounds every git command the refreshed repository handle runs (ADR 0079). */
  readonly signal?: AbortSignal | undefined;
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
  const { repoPath } = session.source;
  const repository = await openSessionRepository(context, repoPath, options.signal);
  if (!repository.ok) {
    return gitFailure(logger, repository.error);
  }
  const baseTip =
    options.baseTip === undefined
      ? await resolveRevision(repository.value, session.source.baseRef)
      : ok(options.baseTip);
  if (!baseTip.ok) {
    if (isRepositoryGone(baseTip.error)) {
      context.caches.probes.delete(repoPath);
    }
    return gitFailure(logger, baseTip.error);
  }
  if (options.headSha !== undefined) {
    const pinned = { ...session, headSha: options.headSha };
    return ok({ session: pinned, repository: repository.value, baseTip: baseTip.value });
  }
  if (session.source.kind !== 'local') {
    return ok({ session, repository: repository.value, baseTip: baseTip.value });
  }
  const advanced = await advanceLocalHead(context, repository.value, session);
  return advanced.ok
    ? ok({ session: advanced.value, repository: repository.value, baseTip: baseTip.value })
    : advanced;
}

/** How often a local head write retries after losing a race to another writer. */
const headWriteAttempts = 3;

/**
 * Resolves a local session's head ref and stores it if it moved. The write is a compare-and-swap
 * (ADR 0079): if another refresh stored a head meanwhile, the session is reloaded and the ref read
 * again, so two `rev-parse`s answering out of order can't leave the older head stored.
 */
async function advanceLocalHead(
  context: SessionContext,
  repository: GitRepository,
  snapshot: Session,
): Promise<Result<Session, IpcError>> {
  const { logger } = context;
  let session = snapshot;
  for (let attempt = 1; ; attempt += 1) {
    if (session.source.kind !== 'local') {
      return ok(session);
    }
    const head = await resolveRevision(repository, session.source.headRef);
    if (!head.ok) {
      return gitFailure(logger, head.error);
    }
    const advanced = advanceHead(session, head.value);
    if (advanced === session) {
      return ok(session);
    }
    const saved = updateSessionHead(context.db, advanced, session.headSha);
    if (saved.ok) {
      context.onHeadMoved?.(advanced.id, advanced.headSha);
      return ok(advanced);
    }
    const { error } = saved;
    if (error.kind === 'session-not-found') {
      return sessionFailure(logger, error);
    }
    if (attempt === headWriteAttempts) {
      return err({ code: 'stale-review', message: 'The head kept moving; try again.' });
    }
    const reloaded = loadSession(context, session.id);
    if (!reloaded.ok) {
      return reloaded;
    }
    session = reloaded.value;
  }
}

/**
 * Whether a failure means the kept probe of the directory no longer holds: the repository moved
 * or went away, or git did. The next open then probes again.
 */
function isRepositoryGone(error: GitError): boolean {
  return (
    error.kind === 'not-a-repository' ||
    error.kind === 'git-not-found' ||
    error.kind === 'unsafe-repository'
  );
}
