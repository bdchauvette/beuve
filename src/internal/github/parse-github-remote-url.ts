import { normalizeGithubHost } from './normalize-github-host.ts';

/** The GitHub repository a git remote URL points at. `host` is lowercase. */
export interface GithubRemote {
  readonly host: string;
  readonly owner: string;
  readonly repo: string;
}

const ownerPattern = /^[a-z\d](?:[a-z\d-]{0,38})$/iu;
const repoPattern = /^[\w.-]{1,100}$/u;
const ssh443Host = 'ssh.github.com';
const schemePattern = /^[a-z][\w+.-]*:\/\//iu;
const trailingSlashes = /\/+$/u;
const gitSuffix = /\.git$/iu;

/**
 * Which GitHub repository a remote URL names: `https://host/owner/repo(.git)`,
 * `ssh://[user@]host[:port]/owner/repo(.git)`, `git://…` and the scp-like `user@host:owner/repo.git`.
 * `ssh.github.com` (GitHub's SSH-over-443 endpoint) counts as `github.com`. Anything else, local
 * paths included, is `undefined`. It doesn't check that the host is a GitHub at all; callers
 * compare the result with a pull request's base repository. Pure.
 */
export function parseGithubRemoteUrl(url: string): GithubRemote | undefined {
  const parts = schemePattern.test(url) ? fromUrl(url) : fromScpLike(url);
  if (parts === undefined) {
    return undefined;
  }
  const host = normalizeGithubHost(parts.host);
  const [owner = '', repoWithSuffix = '', ...rest] = parts.path
    .replace(trailingSlashes, '')
    .split('/');
  const repo = repoWithSuffix.replace(gitSuffix, '');
  if (
    host === undefined ||
    repo === '.' ||
    repo === '..' ||
    rest.length > 0 ||
    !ownerPattern.test(owner) ||
    !repoPattern.test(repo)
  ) {
    return undefined;
  }
  return { host: host === ssh443Host ? 'github.com' : host, owner, repo };
}

interface Parts {
  readonly host: string;
  readonly path: string;
}

function fromUrl(text: string): Parts | undefined {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }
  if (!['https:', 'http:', 'ssh:', 'git:', 'git+ssh:', 'ssh+git:'].includes(url.protocol)) {
    return undefined;
  }
  return url.hostname === '' ? undefined : { host: url.hostname, path: url.pathname.slice(1) };
}

/** `[user@]host:path`, git's scp-like syntax: a colon before any slash, then a relative path. */
function fromScpLike(text: string): Parts | undefined {
  const colon = text.indexOf(':');
  const slash = text.indexOf('/');
  if (colon < 1 || (slash !== -1 && slash < colon) || text[colon + 1] === '/') {
    return undefined;
  }
  const authority = text.slice(0, colon);
  const host = authority.slice(authority.lastIndexOf('@') + 1);
  const path = text.slice(colon + 1);
  return host === '' || path === '' ? undefined : { host, path };
}
