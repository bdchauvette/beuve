import type { DatabaseSync } from 'node:sqlite';

import type { OpenRepositoryOptions } from '#internal/git/open-repository.ts';
import type { SessionDeps } from '#internal/session/session.ts';
import type { Logger } from '#pkg/logger/create-logger.ts';

import type { MainServices } from './main-services.ts';
import { unimplementedMcpTools } from './mcp/unimplemented-mcp-tools.ts';
import { createSessionServices } from './sessions/create-session-services.ts';

export interface MainServicesOptions {
  /** An open, migrated database (see `openAppDatabase`). The caller closes it. */
  readonly db: DatabaseSync;
  readonly logger: Logger;
  readonly deps?: SessionDeps;
  readonly git?: OpenRepositoryOptions;
}

/** Composes the domains behind the IPC handlers and MCP tools. Needs nothing from Electron. */
export function createMainServices(options: MainServicesOptions): MainServices {
  return {
    sessions: createSessionServices(options),
    mcpTools: unimplementedMcpTools,
  };
}
