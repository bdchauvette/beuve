/** The REST root for `host`: `https://api.github.com` or GitHub Enterprise's `https://<host>/api/v3`. */
export function resolveGithubApiBase(host: string): URL {
  if (host === 'github.com') {
    return new URL('https://api.github.com/');
  }
  return new URL(`https://${host}/api/v3/`);
}
