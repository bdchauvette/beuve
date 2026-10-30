/** What a permalink names: a file of a GitHub repository at one commit, and maybe lines of it. */
export interface PermalinkTarget {
  /** `github.com` or a GitHub Enterprise Server hostname. */
  readonly host: string;
  readonly owner: string;
  readonly repo: string;
  /** A full commit sha, so the link never moves. */
  readonly sha: string;
  /** Repository-relative, `/`-separated. */
  readonly path: string;
  /** 1-based; without it the link is to the whole file. */
  readonly startLine?: number;
  /** 1-based, inclusive; a range ending where it starts is a single line. */
  readonly endLine?: number;
}

/**
 * `https://<host>/<owner>/<repo>/blob/<sha>/<path>#L<a>-L<b>`: each path segment, the owner and
 * the repository percent-encoded on their own (so `#`, `?` and spaces in names stay in the path),
 * `#L<a>` for one line and no anchor for the whole file. GitHub Enterprise Server serves the same
 * paths on its own host. Pure.
 */
export function permalinkFrom(target: PermalinkTarget): string {
  const path = target.path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const repository = [target.owner, target.repo].map((part) => encodeURIComponent(part)).join('/');
  const url = `https://${target.host.toLowerCase()}/${repository}/blob/${target.sha}/${path}`;
  const { startLine, endLine } = target;
  if (startLine === undefined) {
    return url;
  }
  return endLine === undefined || endLine <= startLine
    ? `${url}#L${String(startLine)}`
    : `${url}#L${String(startLine)}-L${String(endLine)}`;
}
