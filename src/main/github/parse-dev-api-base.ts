const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * The development-only GitHub API root from `BEUVE_GITHUB_API_URL` (ADR 0040), for a local fake
 * GitHub: only an `http(s)` URL on a loopback address, normalized with a trailing slash, so a
 * token can never be sent to another machine through it. Main reads it only when the app is not
 * packaged. Anything else is `undefined`. Pure.
 */
export function parseDevApiBase(value: string | undefined): URL | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !loopbackHosts.has(url.hostname) ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    return undefined;
  }
  if (!url.pathname.endsWith('/')) {
    url.pathname = `${url.pathname}/`;
  }
  return url;
}
