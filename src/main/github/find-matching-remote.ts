import type { RemoteUrl } from '#internal/git/parse-remote-urls.ts';
import { parseGithubRemoteUrl } from '#internal/github/parse-github-remote-url.ts';

/**
 * The first remote whose configured URL names `host/owner/repo` (case-insensitively, as GitHub
 * treats names), so main fetches a pull request through the user's own remote and credential
 * helper. `undefined` when the clone has none (ADR 0037). Pure.
 */
export function findMatchingRemote(
  remotes: readonly RemoteUrl[],
  repository: { readonly host: string; readonly owner: string; readonly repo: string },
): RemoteUrl | undefined {
  const wanted = key(repository);
  return remotes.find((remote) => {
    const parsed = parseGithubRemoteUrl(remote.url);
    return parsed !== undefined && key(parsed) === wanted;
  });
}

function key(repository: {
  readonly host: string;
  readonly owner: string;
  readonly repo: string;
}): string {
  return `${repository.host}/${repository.owner}/${repository.repo}`.toLowerCase();
}
