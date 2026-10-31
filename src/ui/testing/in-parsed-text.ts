/** `text` as the HTML parser leaves it in an element: without NUL, which it drops. */
export function inParsedText(text: string): string {
  return text.replaceAll('\0', '');
}
