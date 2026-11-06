import { listRemoteUrls } from '#internal/git/list-remote-urls.ts';
import type { GitRepository } from '#internal/git/open-repository.ts';
import type { RemoteUrl } from '#internal/git/parse-remote-urls.ts';
import type { GithubRemote } from '#internal/github/parse-github-remote-url.ts';
import type { Session } from '#internal/session/session.ts';

import { openSessionRepository } from '../sessions/open-session-repository.ts';

import { findMatchingRemote } from './find-matching-remote.ts';
import type { GithubContext } from './github-context.ts';

/** A session's clone, and its remote for the repository the session follows. */
export interface SessionRemote {
  readonly repository: GitRepository;
  readonly remote: string;
}

/** The session whose clone to open, and the repository its remote must name. */
export interface RemoteLookup {
  readonly session: Session;
  readonly repository: GithubRemote;
}

/**
 * Opens a session's clone and finds the remote naming `repository` (ADR 0037), for a poll that
 * fetches into it. `undefined`, logged, when the clone or the remote is gone.
 */
export async function openSessionRemote(
  context: GithubContext,
  { session, repository }: RemoteLookup,
  signal: AbortSignal,
): Promise<SessionRemote | undefined> {
  const { logger } = context.session;
  const opened = await openSessionRepository(context.session, session.source.repoPath, signal);
  if (!opened.ok) {
    logger.warn('github poll: clone unavailable', { error: opened.error });
    return undefined;
  }
  const remotes = await listRemoteUrls(opened.value);
  let remote: RemoteUrl | undefined;
  if (remotes.ok) {
    remote = findMatchingRemote(remotes.value, repository);
  }
  if (remote === undefined) {
    logger.warn('github poll: no remote for the repository', { repository });
    return undefined;
  }
  return { repository: opened.value, remote: remote.name };
}
