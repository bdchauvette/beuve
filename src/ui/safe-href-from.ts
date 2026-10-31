const webUrl = /^https?:\/\//iu;

/**
 * The `href` a Markdown link of untrusted text may have: an absolute `http:` or `https:` URL,
 * normalized by the URL parser, or `undefined` for anything else (`javascript:`, `data:`,
 * `file:`, relative paths, entities that might decode to a scheme). Pure.
 */
export function safeHrefFrom(destination: string): string | undefined {
  const trimmed = destination.trim();
  if (!webUrl.test(trimmed) || !URL.canParse(trimmed)) {
    return undefined;
  }
  const url = new URL(trimmed);
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    return url.href;
  }
  return undefined;
}
