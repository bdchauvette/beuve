import type { IpcError } from '#contract/ipc-contract.ts';
import type { ChatFile } from '#internal/chat/chat-question.ts';
import { diffObjects } from '#internal/git/diff-objects.ts';
import type { CommitSha } from '#internal/git/object-id.ts';
import { resolveRevision } from '#internal/git/resolve-revision.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { chatFileFrom } from '../chat/chat-file-from.ts';
import { findSessionForkPoint } from '../sessions/find-session-fork-point.ts';
import { gitFailure } from '../sessions/git-failure.ts';
import { loadSession } from '../sessions/load-session.ts';
import { refreshSession } from '../sessions/refresh-session.ts';
import type { SessionContext } from '../sessions/session-context.ts';

/** The session and the head a note's anchor refers to. */
export interface NoteDiffQuery {
  readonly sessionId: string;
  readonly headSha: string;
  readonly signal?: AbortSignal | undefined;
}

/**
 * The whole change at a note's head (ADR 0125): fork point to `headSha`, which may be older than
 * the session's head when the note was written against one. The head is not read or stored; a
 * commit the repository no longer has is `not-found`.
 */
export async function loadNoteDiff(
  context: SessionContext,
  { sessionId, headSha, signal }: NoteDiffQuery,
): Promise<Result<readonly ChatFile[], IpcError>> {
  const loaded = loadSession(context, sessionId);
  if (!loaded.ok) {
    return loaded;
  }
  const head = headSha as CommitSha;
  const refreshed = await refreshSession(context, loaded.value, { headSha: head, signal });
  if (!refreshed.ok) {
    return refreshed;
  }
  const { repository, baseTip } = refreshed.value;
  const present = await resolveRevision(repository, head);
  if (!present.ok) {
    if (present.error.kind === 'unknown-revision') {
      return err({ code: 'not-found', message: 'The note’s commit is not in the repository.' });
    }
    return gitFailure(context.logger, present.error);
  }
  const fork = await findSessionForkPoint(
    context,
    { repository, range: { base: baseTip, head } },
    { signal },
  );
  if (!fork.ok) {
    return gitFailure(context.logger, fork.error);
  }
  const files = await diffObjects(repository, { from: fork.value.forkPoint, to: head });
  if (!files.ok) {
    return gitFailure(context.logger, files.error);
  }
  return ok(files.value.map((file) => chatFileFrom(file)));
}
