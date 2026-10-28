import type { DatabaseSync } from 'node:sqlite';

import type { IpcResult, ReviewView, SessionSummary } from '#contract/ipc-contract.ts';
import type { OpenRepositoryOptions } from '#internal/git/open-repository.ts';
import { listSessions } from '#internal/session/list-sessions.ts';
import type { SessionDeps } from '#internal/session/session.ts';
import { systemSessionDeps } from '#internal/session/system-session-deps.ts';
import type { Logger } from '#pkg/logger/create-logger.ts';
import { ok } from '#pkg/result/ok.ts';

import type { SessionServices } from '../main-services.ts';

import { createLocalSession } from './create-local-session.ts';
import { loadReview } from './load-review.ts';
import { loadSession } from './load-session.ts';
import { markReviewed } from './mark-reviewed.ts';
import type { SessionContext } from './session-context.ts';
import { sessionFailure } from './session-failure.ts';
import { toSessionSummary } from './to-session-summary.ts';

export interface SessionServicesOptions {
  readonly db: DatabaseSync;
  readonly logger: Logger;
  /** Clock and id generator; defaults to the system ones. */
  readonly deps?: SessionDeps;
  readonly git?: OpenRepositoryOptions;
}

/**
 * The renderer's session operations, backed by the session repository and the git domain.
 * Requests are shape-validated by the IPC layer; ids and refs are validated here and by git.
 */
export function createSessionServices(options: SessionServicesOptions): SessionServices {
  const context: SessionContext = {
    db: options.db,
    logger: options.logger,
    deps: options.deps ?? systemSessionDeps,
    git: { ...options.git, logger: options.git?.logger ?? options.logger },
  };
  return {
    list: (): IpcResult<readonly SessionSummary[]> => listSummaries(context),
    open: ({ sessionId }): IpcResult<SessionSummary> => openSummary(context, sessionId),
    createLocal: async (request): Promise<IpcResult<SessionSummary>> =>
      createLocalSession(context, request),
    getReview: async ({ sessionId }): Promise<IpcResult<ReviewView>> =>
      loadReview(context, sessionId),
    markReviewed: async (request): Promise<IpcResult<SessionSummary>> =>
      markReviewed(context, request),
  };
}

function listSummaries(context: SessionContext): IpcResult<readonly SessionSummary[]> {
  const sessions = listSessions(context.db);
  return sessions.ok
    ? ok(sessions.value.map((session) => toSessionSummary(session)))
    : sessionFailure(context.logger, sessions.error);
}

function openSummary(context: SessionContext, sessionId: string): IpcResult<SessionSummary> {
  const session = loadSession(context, sessionId);
  return session.ok ? ok(toSessionSummary(session.value)) : session;
}
