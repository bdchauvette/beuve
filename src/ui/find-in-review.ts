import type { DiffFileView } from '#contract/ipc-contract.ts';

/** One hit of "Find in review" (ADR 0051): a line of a file's patch, by the side it is on. */
export interface ReviewMatch {
  readonly fileIndex: number;
  readonly path: string;
  /** `base` for a deleted line (numbered on the base side); `head` for added and context lines. */
  readonly side: 'head' | 'base';
  readonly line: number;
  /** Where the hit starts in the line's text, and its length. */
  readonly column: number;
  readonly length: number;
}

export interface FindOptions {
  readonly isCaseSensitive?: boolean;
  /** Stops after this many hits; the bar then says "more than". Defaults to 5000. */
  readonly limit?: number;
}

const defaultLimit = 5000;

/**
 * Every occurrence of `query` in the review's patch text, in stream order (files, then lines,
 * then columns), searching the data rather than the DOM: collapsed, unmounted and offscreen
 * cards are found the same way. Only diff lines count (context, added, deleted), not headers;
 * a hit never spans lines. Case-insensitive unless asked. Pure.
 */
export function findInReview(
  files: readonly DiffFileView[],
  query: string,
  options: FindOptions = {},
): ReviewMatch[] {
  const limit = options.limit ?? defaultLimit;
  const isCaseSensitive = options.isCaseSensitive ?? false;
  const folded = (value: string): string => {
    if (isCaseSensitive) {
      return value;
    }
    return value.toLowerCase();
  };
  const needle = folded(query);
  const matches: ReviewMatch[] = [];
  if (needle === '') {
    return matches;
  }
  for (const [fileIndex, file] of files.entries()) {
    let oldLine = 0;
    let newLine = 0;
    let isInHunk = false;
    for (const raw of file.patch.split('\n')) {
      const header = parseHunkStarts(raw);
      if (header !== undefined) {
        [oldLine, newLine] = header;
        isInHunk = true;
        continue;
      }
      const marker = raw[0];
      if (!isInHunk || (marker !== ' ' && marker !== '+' && marker !== '-')) {
        isInHunk &&= marker === '\\';
        continue;
      }
      let side: ReviewMatch['side'] = 'head';
      let line = newLine;
      if (marker === '-') {
        side = 'base';
        line = oldLine;
      }
      const text = folded(raw.slice(1));
      for (
        let column = text.indexOf(needle);
        column !== -1;
        column = text.indexOf(needle, column + needle.length)
      ) {
        matches.push({ fileIndex, path: file.path, side, line, column, length: query.length });
        if (matches.length >= limit) {
          return matches;
        }
      }
      if (marker !== '+') {
        oldLine += 1;
      }
      if (marker !== '-') {
        newLine += 1;
      }
    }
  }
  return matches;
}

/** The first old and new line of `@@ -a,b +c,d @@ …`, or `undefined` for any other line. */
function parseHunkStarts(text: string): readonly [number, number] | undefined {
  if (!text.startsWith('@@ -')) {
    return undefined;
  }
  const [, oldSide = '', newSide = ''] = text.split(' ', 3);
  const oldStart = Number(oldSide.slice(1).split(',', 1)[0]);
  const newStart = Number(newSide.slice(1).split(',', 1)[0]);
  if (newSide.startsWith('+') && Number.isSafeInteger(oldStart) && Number.isSafeInteger(newStart)) {
    return [oldStart, newStart];
  }
  return undefined;
}
