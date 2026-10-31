import type { RemoteUrl } from '#internal/git/parse-remote-urls.ts';
import { parseGithubRemoteUrl } from '#internal/github/parse-github-remote-url.ts';
import type { GithubRemote } from '#internal/github/parse-github-remote-url.ts';

/** The remote permalinks point at, and the GitHub repository it stands for. */
export interface PrimaryRemote {
  readonly name: string;
  readonly repository: GithubRemote;
}

/**
 * Which remote a permalink (ADR 0067) points at: for a pull request session the remote naming its
 * base repository, else `origin` when it is a GitHub URL, else the first remote that is. Names
 * compare case-insensitively, as GitHub treats them. `undefined` without any GitHub remote. Pure.
 */
export function choosePrimaryRemote(
  remotes: readonly RemoteUrl[],
  pullRequestBase?: GithubRemote,
): PrimaryRemote | undefined {
  const parsed: PrimaryRemote[] = [];
  for (const remote of remotes) {
    const repository = parseGithubRemoteUrl(remote.url);
    if (repository !== undefined) {
      parsed.push({ name: remote.name, repository });
    }
  }
  let base: string | undefined;
  if (pullRequestBase !== undefined) {
    base = keyOf(pullRequestBase);
  }
  return (
    parsed.find((remote) => base !== undefined && keyOf(remote.repository) === base) ??
    parsed.find((remote) => remote.name === 'origin') ??
    parsed[0]
  );
}

function keyOf(repository: GithubRemote): string {
  return `${repository.host}/${repository.owner}/${repository.repo}`.toLowerCase();
}
