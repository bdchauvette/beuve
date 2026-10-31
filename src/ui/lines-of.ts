const finalNewline = /\n$/u;

/** `text` split at `\n`, without the empty line after a final newline. Pure. */
export function linesOf(text: string): string[] {
  return text.replace(finalNewline, '').split('\n');
}
