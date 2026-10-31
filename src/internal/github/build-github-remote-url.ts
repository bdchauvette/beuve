import type { GithubRemote } from './parse-github-remote-url.ts';

/**
 * The HTTPS clone URL of `owner/repo` on `host`, without credentials: git authenticates through
 * the user's own credential helper (ADR 0035), never a token in the URL. Inputs must come from
 * `parsePullRequestRef` or a decoded pull request. Pure.
 */
export function buildGithubRemoteUrl(repository: GithubRemote): string {
  return `https://${repository.host}/${repository.owner}/${repository.repo}.git`;
}
