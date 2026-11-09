const tagPattern = /<[^>]*>/gu;
const handlerPattern = /([\s"'/])(on[a-z]+\s*=)/giu;

/**
 * `text` with every `on…=` attribute inside a tag renamed to `data-dropped-on…` (ADR 0123), for
 * raw HTML in Markdown and labels in a Mermaid diagram. Nothing here is a defence: the sanitizers
 * remove handlers either way. Chromium reports an inline handler to the CSP as soon as it parses
 * one, even into an inert document, and a file's own markup should not raise violations. Pure.
 */
export function withoutHandlers(text: string): string {
  return text.replaceAll(tagPattern, (tag) => {
    return tag.replaceAll(handlerPattern, '$1data-dropped-$2');
  });
}
