import type { SessionSummary } from '#contract/ipc-contract.ts';

/**
 * The clone the reviewer last used for a GitHub repository, from their pull request sessions
 * (most recently updated first), so the open panel can show it before asking main. Main also
 * remembers clones itself (ADR 0037); this only makes that visible and editable. Pure.
 */
export function findKnownClone(
  sessions: readonly SessionSummary[],
  repository: { readonly host: string; readonly owner: string; readonly repo: string },
): string | undefined {
  const key = `${repository.host}/${repository.owner}/${repository.repo}`.toLowerCase();
  return sessions
    .filter(
      ({ source }) =>
        source.kind === 'github-pull-request' &&
        `${source.host}/${source.owner}/${source.repo}`.toLowerCase() === key,
    )
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.source.repoPath;
}
