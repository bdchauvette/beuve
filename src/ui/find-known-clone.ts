import type { SessionSummary } from '#contract/ipc-contract.ts';

/** A GitHub repository by host, owner and name. */
export interface GithubRepositoryName {
  readonly host: string;
  readonly owner: string;
  readonly repo: string;
}

/**
 * The clone the reviewer last used for a GitHub repository, from their pull request and branch
 * sessions (most recently updated first), so the open panel can show it before asking main.
 * Main also remembers clones itself (ADR 0037); this only makes that visible and editable. Pure.
 */
export function findKnownClone(
  sessions: readonly SessionSummary[],
  repository: GithubRepositoryName,
): string | undefined {
  const key = `${repository.host}/${repository.owner}/${repository.repo}`.toLowerCase();
  return sessions
    .filter(({ source }) => {
      return (
        source.kind !== 'local' &&
        `${source.host}/${source.owner}/${source.repo}`.toLowerCase() === key
      );
    })
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.source.repoPath;
}
