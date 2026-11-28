import { parseInlineTitle } from './parse-inline-title.ts';

/**
 * A one-line title's text without its inline Markdown (`parseInlineTitle`), for where only a plain
 * string fits, such as the status bar: "Rename `a` to `b`" is "Rename a to b". Pure.
 */
export function plainTitleFrom(title: string): string {
  return parseInlineTitle(title)
    .map((span) => span.text)
    .join('');
}
