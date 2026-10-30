import type { IpcError } from '#contract/ipc-contract.ts';
import type { CommitSha } from '#internal/git/object-id.ts';
import { resolveRevision } from '#internal/git/resolve-revision.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { gitFailure } from '../sessions/git-failure.ts';
import { loadSession } from '../sessions/load-session.ts';
import { refreshSession } from '../sessions/refresh-session.ts';
import type { RefreshedSession } from '../sessions/refresh-session.ts';
import type { SessionContext } from '../sessions/session-context.ts';

/** A session brought up to date, and a commit of its repository the renderer named. */
export interface SheetCommit {
  readonly refreshed: RefreshedSession;
  readonly sha: CommitSha;
}

/**
 * Refreshes the session and checks that `sha` (untrusted; the session head when absent) names a
 * commit of its repository by its full object name, so a sheet is always pinned to one exact
 * commit (ADR 0067).
 */
export async function resolveSheetCommit(
  context: SessionContext,
  sessionId: string,
  sha: string | undefined,
): Promise<Result<SheetCommit, IpcError>> {
  const loaded = loadSession(context, sessionId);
  if (!loaded.ok) {
    return loaded;
  }
  const refreshed = await refreshSession(context, loaded.value);
  if (!refreshed.ok) {
    return refreshed;
  }
  if (sha === undefined) {
    return ok({ refreshed: refreshed.value, sha: refreshed.value.session.headSha });
  }
  const resolved = await resolveRevision(refreshed.value.repository, sha);
  if (!resolved.ok) {
    return resolved.error.kind === 'unknown-revision'
      ? err({ code: 'not-found', message: 'that commit is not in the repository' })
      : gitFailure(context.logger, resolved.error);
  }
  return resolved.value === sha
    ? ok({ refreshed: refreshed.value, sha: resolved.value })
    : err({ code: 'invalid-request', message: 'expected a full commit sha' });
}
