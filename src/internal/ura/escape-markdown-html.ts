/**
 * Makes one line of inline Markdown (an item title) safe to embed: `<` becomes `&lt;`, so text
 * like `Prefer <const>` shows as written instead of being taken for an HTML tag that renderers
 * strip. Other Markdown (code spans, emphasis) is kept on purpose.
 */
export function escapeMarkdownHtml(text: string): string {
  return text.replaceAll('<', '&lt;');
}
