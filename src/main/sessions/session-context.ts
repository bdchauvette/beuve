import type { DatabaseSync } from 'node:sqlite';

import type { OpenRepositoryOptions } from '#internal/git/open-repository.ts';
import type { SessionDeps } from '#internal/session/session.ts';
import type { Logger } from '#pkg/logger/create-logger.ts';

/** What the session service operations share: the open database, effects and git settings. */
export interface SessionContext {
  readonly db: DatabaseSync;
  readonly deps: SessionDeps;
  readonly logger: Logger;
  readonly git: OpenRepositoryOptions;
  /** Told whenever a refresh stores a new head, so main can abort work for the old one. */
  readonly onHeadMoved?: (sessionId: string, headSha: string) => void;
}
