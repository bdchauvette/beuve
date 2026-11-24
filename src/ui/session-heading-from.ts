import type { SessionSummary } from '#contract/ipc-contract.ts';

/**
 * The title bar's name for the open review, in parts that look different (ADR 0157 amendment):
 * where it is (`owner/repo`, or a local repository's folder), a pull request's number, and what
 * it is: the pull request's title, or the branch, which `isBranch` sets in the code font.
 */
export interface SessionHeading {
  readonly context: string;
  /** `#12` for a pull request. */
  readonly number?: string;
  /** Empty while a pull request's title is not known yet. */
  readonly name: string;
  readonly isBranch: boolean;
}

/**
 * The open session's heading, from the listed summary (which carries a pull request's title) or
 * else the review's own session; `undefined` with none open. Pure.
 */
export function sessionHeadingFrom(
  sessions: readonly SessionSummary[],
  selectedId: string,
  open: SessionSummary | undefined,
): SessionHeading | undefined {
  let session = sessions.find(({ id }) => id === selectedId);
  if (session === undefined && open?.id === selectedId) {
    session = open;
  }
  if (session === undefined) {
    return undefined;
  }
  const { source } = session;
  switch (source.kind) {
    case 'github-pull-request': {
      return {
        context: `${source.owner}/${source.repo}`,
        number: `#${String(source.number)}`,
        name: session.pullRequest?.title ?? '',
        isBranch: false,
      };
    }
    case 'remote-branch': {
      let name = source.branch;
      if (session.remoteBranch?.state === 'gone') {
        name = `${source.branch} (gone)`;
      }
      return { context: `${source.owner}/${source.repo}`, name, isBranch: true };
    }
    case 'local': {
      const context = source.repoPath.split('/').findLast((part) => part !== '') ?? source.repoPath;
      let name = source.headRef;
      if (name.startsWith('refs/heads/')) {
        name = name.slice('refs/heads/'.length);
      }
      return { context, name, isBranch: true };
    }
  }
}
