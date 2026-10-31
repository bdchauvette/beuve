import type { RemoteUrl } from '#internal/git/parse-remote-urls.ts';
import { parseGithubRemoteUrl } from '#internal/github/parse-github-remote-url.ts';
import type { GithubRemote } from '#internal/github/parse-github-remote-url.ts';

/**
 * The first remote whose configured URL names `host/owner/repo` (case-insensitively, as GitHub
 * treats names), so main fetches a pull request through the user's own remote and credential
 * helper. `undefined` when the clone has none (ADR 0037). Pure.
 */
export function findMatchingRemote(
  remotes: readonly RemoteUrl[],
  repository: GithubRemote,
): RemoteUrl | undefined {
  const wanted = key(repository);
  return remotes.find((remote) => {
    const parsed = parseGithubRemoteUrl(remote.url);
    return parsed !== undefined && key(parsed) === wanted;
  });
}

function key(repository: GithubRemote): string {
  return `${repository.host}/${repository.owner}/${repository.repo}`.toLowerCase();
}
