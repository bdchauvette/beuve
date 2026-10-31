/** One find hit in a sheet: a 1-based line and UTF-16 columns, `end` exclusive. */
export interface SheetMatch {
  readonly line: number;
  readonly start: number;
  readonly end: number;
}

const maxMatches = 10_000;
const lineBreak = /\r\n|\n|\r/u;

/** What to look for, and the file text to look in. */
export interface SheetSearch {
  readonly query: string;
  readonly text: string;
}

/**
 * Every occurrence of `query` in `text` (ADR 0067), line by line, in order. Smart case: a query
 * with no capital letter matches any case. Matches don't overlap and don't span lines; an empty
 * query finds nothing. Stops after 10 000. Pure.
 */
export function findSheetMatches({ query, text }: SheetSearch): readonly SheetMatch[] {
  if (query === '') {
    return [];
  }
  const isCaseSensitive = query !== query.toLowerCase();
  const folded = (value: string): string => {
    if (isCaseSensitive) {
      return value;
    }
    return value.toLowerCase();
  };
  const needle = folded(query);
  const matches: SheetMatch[] = [];
  for (const [index, raw] of text.split(lineBreak).entries()) {
    const line = folded(raw);
    for (let at = line.indexOf(needle); at !== -1; at = line.indexOf(needle, at + needle.length)) {
      matches.push({ line: index + 1, start: at, end: at + needle.length });
      if (matches.length >= maxMatches) {
        return matches;
      }
    }
  }
  return matches;
}
