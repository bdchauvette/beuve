/**
 * Whether a link from a pull request body may open in the system browser (ADR 0040): plain
 * `https://` on one of `hosts` (github.com and the GitHub Enterprise hosts beuve has pull
 * requests from), with no credentials or port. Everything else stays unopened. Pure.
 */
export function isAllowedGithubLink(text: string, hosts: ReadonlySet<string>): boolean {
  const url = URL.parse(text);
  return (
    url !== null &&
    url.protocol === 'https:' &&
    url.username === '' &&
    url.password === '' &&
    url.port === '' &&
    hosts.has(url.hostname.toLowerCase())
  );
}
