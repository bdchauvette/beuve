import type { IpcError } from '#contract/ipc-contract.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { loadSession } from './load-session.ts';
import { refreshSession } from './refresh-session.ts';
import type { RefreshedSession } from './refresh-session.ts';
import type { SessionContext } from './session-context.ts';

/** A session id with the head git reports for it right now. */
export interface SessionHead {
  readonly sessionId: string;
  readonly headSha: string;
}

/**
 * Refreshes a session from git (storing a moved head) and returns its id and head, for work keyed
 * by (session, head). `refreshed` is kept for callers that need the repository.
 */
export async function refreshSessionHead(
  context: SessionContext,
  sessionId: string,
): Promise<Result<SessionHead & { readonly refreshed: RefreshedSession }, IpcError>> {
  const loaded = loadSession(context, sessionId);
  if (!loaded.ok) {
    return loaded;
  }
  const refreshed = await refreshSession(context, loaded.value);
  return refreshed.ok
    ? ok({
        sessionId: refreshed.value.session.id,
        headSha: refreshed.value.session.headSha,
        refreshed: refreshed.value,
      })
    : refreshed;
}
