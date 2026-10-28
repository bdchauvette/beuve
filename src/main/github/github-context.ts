import type { SessionContext } from '../sessions/session-context.ts';

import type { ClonePathSettings } from './create-clone-path-settings.ts';
import type { GithubClients } from './create-github-clients.ts';

/** What the GitHub operations in main share. */
export interface GithubContext {
  readonly session: SessionContext;
  readonly clients: GithubClients;
  readonly clonePaths: ClonePathSettings;
}
