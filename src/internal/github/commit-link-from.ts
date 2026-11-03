/** What a commit link names: a commit of a GitHub repository. */
export interface CommitLinkTarget {
  /** `github.com` or a GitHub Enterprise Server hostname. */
  readonly host: string;
  readonly owner: string;
  readonly repo: string;
  /** A full commit sha, so the link never moves. */
  readonly sha: string;
}

/**
 * `https://<host>/<owner>/<repo>/commit/<sha>`, with the owner and the repository percent-encoded
 * on their own. GitHub Enterprise Server serves the same paths on its own host. Pure.
 */
export function commitLinkFrom(target: CommitLinkTarget): string {
  const repository = [target.owner, target.repo].map((part) => encodeURIComponent(part)).join('/');
  return `https://${target.host.toLowerCase()}/${repository}/commit/${target.sha}`;
}
