import type { SessionSummary } from '#contract/ipc-contract.ts';

/**
 * The titlebar's name for the open session: `owner/repo#n Title` for a pull request, `folder ·
 * head against base` for a local branch, or `Open a review…` with none open. It prefers the
 * listed summary, which carries the pull request title, and falls back to the review's own
 * session, so a session opened before the list caught up is still named.
 */
export function describeSessionLabel(
  sessions: readonly SessionSummary[],
  selectedId: string,
  open: SessionSummary | undefined,
): string {
  const session =
    sessions.find(({ id }) => id === selectedId) ?? (open?.id === selectedId ? open : undefined);
  if (session === undefined) {
    return 'Open a review…';
  }
  const { source } = session;
  if (source.kind === 'github-pull-request') {
    const title = session.pullRequest === undefined ? '' : ` ${session.pullRequest.title}`;
    return `${source.owner}/${source.repo}#${String(source.number)}${title}`;
  }
  const folder = source.repoPath.split('/').findLast((part) => part !== '') ?? source.repoPath;
  return `${folder} · ${source.headRef} against ${source.baseRef}`;
}
