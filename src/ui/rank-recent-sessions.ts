import type { SessionSummary } from '#contract/ipc-contract.ts';

const whitespace = /\s+/u;

/**
 * Recent sessions for the open panel: most recently updated first, keeping only those whose
 * title, repository, number, folder or refs contain every word of `filter` (case-insensitive).
 * Pure.
 */
export function rankRecentSessions(
  sessions: readonly SessionSummary[],
  filter: string,
  limit = 8,
): SessionSummary[] {
  const words = filter
    .toLowerCase()
    .split(whitespace)
    .filter((word) => word !== '');
  return sessions
    .filter((session) => {
      const haystack = searchText(session);
      return words.every((word) => haystack.includes(word));
    })
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

function searchText(session: SessionSummary): string {
  return searchParts(session).join(' ').toLowerCase();
}

function searchParts(session: SessionSummary): readonly string[] {
  const { source } = session;
  if (source.kind === 'github-pull-request') {
    return [
      session.pullRequest?.title ?? '',
      `${source.owner}/${source.repo}#${String(source.number)}`,
      source.repoPath,
    ];
  }
  if (source.kind === 'remote-branch') {
    return [`${source.owner}/${source.repo}:${source.branch}`, source.repoPath];
  }
  return [source.repoPath, source.baseRef, source.headRef];
}
