import type { SessionSummary } from '#contract/ipc-contract.ts';

/**
 * The titlebar's name for the open session: `owner/repo#n Title` for a pull request,
 * `owner/repo:branch` for a followed branch (with `(gone)` once deleted), `folder · head against
 * base` for a local branch, or `Open a review…` with none open. It prefers the
 * listed summary, which carries the pull request title, and falls back to the review's own
 * session, so a session opened before the list caught up is still named.
 */
export function describeSessionLabel(
  sessions: readonly SessionSummary[],
  selectedId: string,
  open: SessionSummary | undefined,
): string {
  let session = sessions.find(({ id }) => id === selectedId);
  if (session === undefined && open?.id === selectedId) {
    session = open;
  }
  if (session === undefined) {
    return 'Open a review…';
  }
  const { source } = session;
  if (source.kind === 'github-pull-request') {
    const number = `${source.owner}/${source.repo}#${String(source.number)}`;
    if (session.pullRequest === undefined) {
      return number;
    }
    return `${number} ${session.pullRequest.title}`;
  }
  if (source.kind === 'remote-branch') {
    const name = `${source.owner}/${source.repo}:${source.branch}`;
    if (session.remoteBranch?.state === 'gone') {
      return `${name} (gone)`;
    }
    return name;
  }
  const folder = source.repoPath.split('/').findLast((part) => part !== '') ?? source.repoPath;
  return `${folder} · ${source.headRef} against ${source.baseRef}`;
}
