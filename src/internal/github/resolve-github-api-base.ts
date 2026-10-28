/** The REST root for `host`: `https://api.github.com` or GitHub Enterprise's `https://<host>/api/v3`. */
export function resolveGithubApiBase(host: string): URL {
  return new URL(host === 'github.com' ? 'https://api.github.com/' : `https://${host}/api/v3/`);
}
