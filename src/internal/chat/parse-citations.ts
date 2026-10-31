/** One well-formed `[[path:start-end]]` marker in an answer. */
export interface CitationMarker {
  /** Offset of the opening `[[` in the answer. */
  readonly index: number;
  /** Length of the whole marker, brackets included. */
  readonly length: number;
  /** As written, with a leading `./` removed; not yet checked against any file list. */
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
}

export interface ParsedCitations {
  /** In order of appearance. */
  readonly markers: readonly CitationMarker[];
  /** `[[…]]` spans that are not a well-formed citation (no line, bad range, …). */
  readonly malformed: number;
}

/**
 * Finds the citation markers in an answer (ADR 0031): `[[path:line]]` or `[[path:start-end]]`,
 * on one line, with 1-based lines and `start <= end`. The path is everything before the last
 * colon, so a path may itself contain one. Pure; it neither rewrites the answer nor checks paths.
 */
export function parseCitations(answer: string): ParsedCitations {
  const markers: CitationMarker[] = [];
  let malformed = 0;
  for (const match of answer.matchAll(bracketed)) {
    const marker = markerFrom(match[1] ?? '', { index: match.index, length: match[0].length });
    if (marker === undefined) {
      malformed += 1;
    } else {
      markers.push(marker);
    }
  }
  return { markers, malformed };
}

const bracketed = /\[\[([^[\]\n]{1,512})\]\]/gu;
const lineNumber = /^\d{1,9}$/u;
const leadingDotSlash = /^(?:\.\/)+/u;

function markerFrom(
  inner: string,
  { index, length }: Pick<CitationMarker, 'index' | 'length'>,
): CitationMarker | undefined {
  const colon = inner.lastIndexOf(':');
  if (colon === -1) {
    return undefined;
  }
  const path = inner.slice(0, colon).replace(leadingDotSlash, '');
  const [start = '', end = start, ...rest] = inner.slice(colon + 1).split('-');
  if (rest.length > 0 || !lineNumber.test(start) || !lineNumber.test(end)) {
    return undefined;
  }
  const startLine = Number(start);
  const endLine = Number(end);
  const isValid = startLine >= 1 && endLine >= startLine && path !== '' && path.trim() === path;
  if (isValid) {
    return { index, length, path, startLine, endLine };
  }
  return undefined;
}
