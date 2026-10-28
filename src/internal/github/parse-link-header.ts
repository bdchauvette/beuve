const linkPattern = /<([^>]*)>([^,<]*)/g;
const relPattern = /\brel="?([^";]+)"?/i;
const whitespace = /\s+/;

/**
 * The URLs of an RFC 8288 `Link` header by relation, e.g. `next` and `last` from GitHub's
 * `<https://api.github.com/…&page=2>; rel="next", <…&page=5>; rel="last"`. Pure.
 */
export function parseLinkHeader(header = ''): ReadonlyMap<string, string> {
  const links = new Map<string, string>();
  const matches = header.matchAll(linkPattern);
  for (const [, url, parameters = ''] of matches) {
    const relations = relPattern.exec(parameters)?.[1];
    if (url === undefined || relations === undefined) {
      continue;
    }
    for (const relation of relations.trim().split(whitespace)) {
      if (!links.has(relation)) {
        links.set(relation.toLowerCase(), url);
      }
    }
  }
  return links;
}
