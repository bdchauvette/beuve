import type { DatabaseSync } from 'node:sqlite';

import type {
  IpcResult,
  RepositoryInspectionView,
  ReviewView,
  SessionSummary,
  SetFileReviewedResponse,
} from '#contract/ipc-contract.ts';
import type { OpenRepositoryOptions } from '#internal/git/open-repository.ts';
import { listSessions } from '#internal/session/list-sessions.ts';
import type { SessionDeps } from '#internal/session/session.ts';
import { systemSessionDeps } from '#internal/session/system-session-deps.ts';

import type { Logger } from '#x/log/create-logger.ts';
import { ok } from '#x/result/ok.ts';

import type { SessionServices } from '../main-services.ts';

import { createLocalSession } from './create-local-session.ts';
import { inspectRepository } from './inspect-repository.ts';
import { loadReview } from './load-review.ts';
import { createGitCaches } from './create-git-caches.ts';
import type { GitCaches } from './create-git-caches.ts';
import { markReviewed } from './mark-reviewed.ts';
import { setFileReviewed } from './set-file-reviewed.ts';
import type { SessionContext } from './session-context.ts';
import { sessionFailure } from './session-failure.ts';
import { sessionSummaryFrom } from './session-summary-from.ts';

export interface SessionServicesOptions {
  readonly db: DatabaseSync;
  readonly logger: Logger;
  /** Clock and id generator; defaults to the system ones. */
  readonly deps?: SessionDeps;
  readonly git?: OpenRepositoryOptions;
  readonly onHeadMoved?: (sessionId: string, headSha: string) => void;
  /** The caches main shares between its services (ADR 0081); new ones by default. */
  readonly caches?: GitCaches;
}

/**
 * The renderer's session operations, backed by the session repository and the git domain.
 * Requests are shape-validated by the IPC layer; ids and refs are validated here and by git.
 * The diffs `getReview` shows come from the shared range-diff cache, keyed by commits and
 * whitespace variant, so toggling whitespace back and forth runs git once per variant.
 */
export function createSessionServices(options: SessionServicesOptions): SessionServices {
  const context: SessionContext = {
    db: options.db,
    logger: options.logger,
    deps: options.deps ?? systemSessionDeps,
    git: { ...options.git, logger: options.git?.logger ?? options.logger },
    caches: options.caches ?? createGitCaches(),
    ...(options.onHeadMoved !== undefined && { onHeadMoved: options.onHeadMoved }),
  };
  return {
    list: (): IpcResult<readonly SessionSummary[]> => {
      return listSummaries(context);
    },
    createLocal: async (request): Promise<IpcResult<SessionSummary>> => {
      return createLocalSession(context, request);
    },
    getReview: async (
      { sessionId, ignoreWhitespace },
      call = {},
    ): Promise<IpcResult<ReviewView>> => {
      return loadReview(context, sessionId, {
        ignoreWhitespace: ignoreWhitespace === true,
        signal: call.signal,
      });
    },
    markReviewed: async (request): Promise<IpcResult<SessionSummary>> => {
      return markReviewed(context, request);
    },
    setFileReviewed: async (request): Promise<IpcResult<SetFileReviewedResponse>> => {
      return setFileReviewed(context, request);
    },
    inspectRepository: async (request): Promise<IpcResult<RepositoryInspectionView>> => {
      return inspectRepository(context, request);
    },
  };
}

function listSummaries(context: SessionContext): IpcResult<readonly SessionSummary[]> {
  const sessions = listSessions(context.db);
  if (sessions.ok) {
    return ok(sessions.value.map((session) => sessionSummaryFrom(session)));
  }
  return sessionFailure(context.logger, sessions.error);
}
