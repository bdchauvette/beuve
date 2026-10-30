/** One find hit in a sheet: a 1-based line and UTF-16 columns, `end` exclusive. */
export interface SheetMatch {
  readonly line: number;
  readonly start: number;
  readonly end: number;
}

const maxMatches = 10_000;
const lineBreak = /\r\n|\n|\r/u;

/**
 * Every occurrence of `query` in `text` (ADR 0067), line by line, in order. Smart case: a query
 * with no capital letter matches any case. Matches don't overlap and don't span lines; an empty
 * query finds nothing. Stops after 10 000. Pure.
 */
export function findSheetMatches(text: string, query: string): readonly SheetMatch[] {
  if (query === '') {
    return [];
  }
  const isCaseSensitive = query !== query.toLowerCase();
  const needle = isCaseSensitive ? query : query.toLowerCase();
  const matches: SheetMatch[] = [];
  for (const [index, raw] of text.split(lineBreak).entries()) {
    const line = isCaseSensitive ? raw : raw.toLowerCase();
    for (let at = line.indexOf(needle); at !== -1; at = line.indexOf(needle, at + needle.length)) {
      matches.push({ line: index + 1, start: at, end: at + needle.length });
      if (matches.length >= maxMatches) {
        return matches;
      }
    }
  }
  return matches;
}
