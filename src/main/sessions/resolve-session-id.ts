import { listSessions } from '#internal/session/list-sessions.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { SessionContext } from './session-context.ts';

/**
 * Which session an agent means (ADR 0021): the id it passed; else the session the reviewer has
 * open in beuve; else the only session there is. Anything else is ambiguous, and the message
 * lists the candidates so the agent can pass `sessionId`.
 */
export function resolveSessionId(
  context: SessionContext,
  requested: string | undefined,
  openSessionId: string | undefined,
): Result<string, string> {
  if (requested !== undefined) {
    return ok(requested);
  }
  if (openSessionId !== undefined) {
    return ok(openSessionId);
  }
  const sessions = listSessions(context.db);
  if (!sessions.ok) {
    return err('could not list review sessions');
  }
  const [only, ...others] = sessions.value;
  if (only === undefined) {
    return err('no review session exists yet: open a repository in beuve first');
  }
  if (others.length > 0) {
    const candidates = sessions.value
      .map((session) => `${session.id} (${session.source.repoPath} ${session.source.baseRef})`)
      .join(', ');
    return err(
      `several review sessions exist and none is open in beuve; pass sessionId: ${candidates}`,
    );
  }
  return ok(only.id);
}
