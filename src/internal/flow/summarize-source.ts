const whitespace = /\s+/g;
const trailingSemicolon = /;$/;

/** Shortens source to one trimmed line of at most `max` characters, marking what was cut with `…`. */
export function summarizeSource(text: string, max: number): string {
  const lines = text
    .split('\n')
    .map((line) => line.replaceAll(whitespace, ' ').trim())
    .filter((line) => line !== '');
  const first = (lines[0] ?? '').replace(trailingSemicolon, '');
  if (lines.length <= 1 && first.length <= max) {
    return first;
  }
  const cut = first.slice(0, max - 1);
  return `${cut.trimEnd()}…`;
}
