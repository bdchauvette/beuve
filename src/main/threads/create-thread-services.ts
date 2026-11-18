import type { GithubFailureView, IpcResult, ReviewThreadsView } from '#contract/ipc-contract.ts';
import type { SessionSource } from '#internal/session/session.ts';
import { ok } from '#x/result/ok.ts';

import type { RequestOptions } from '../request-options.ts';
import { loadSession } from '../sessions/load-session.ts';
import type { SessionContext } from '../sessions/session-context.ts';

/**
 * A host's way to read other reviewers' line comments (ADR 0140). It maps the host's API to the
 * host-neutral model in its own domain; this port only says which sources it serves.
 */
export interface ThreadAdapter {
  readonly supports: (source: SessionSource) => boolean;
  readonly list: (
    source: SessionSource,
    options?: RequestOptions,
  ) => Promise<IpcResult<ReviewThreadsView | GithubFailureView>>;
}

/** `review:get-threads`: a session's line threads, from the adapter that serves its source. */
export interface ThreadServices {
  readonly getThreads: (
    sessionId: string,
    options?: RequestOptions,
  ) => Promise<IpcResult<ReviewThreadsView | GithubFailureView>>;
}

export interface ThreadServicesOptions {
  readonly context: SessionContext;
  /** Asked in order; the first whose `supports` is true answers. */
  readonly adapters: readonly ThreadAdapter[];
}

/**
 * Reads a session's line threads through the first adapter that serves its source, and answers
 * `unsupported` when none does (a local branch, a followed branch).
 */
export function createThreadServices(options: ThreadServicesOptions): ThreadServices {
  return {
    getThreads: async (
      sessionId,
      call = {},
    ): Promise<IpcResult<ReviewThreadsView | GithubFailureView>> => {
      const loaded = loadSession(options.context, sessionId);
      if (!loaded.ok) {
        return loaded;
      }
      const { source } = loaded.value;
      const adapter = options.adapters.find((candidate) => candidate.supports(source));
      if (adapter === undefined) {
        return ok({ kind: 'unsupported' });
      }
      return adapter.list(source, call);
    },
  };
}
