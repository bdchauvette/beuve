import type { ChangeRun } from './change-run.ts';
import type { LineRange } from './line-range.ts';

/** The first base and head line of a hunk. */
interface HunkStarts {
  readonly base: number;
  readonly head: number;
}

/** Where reading a patch has got to. */
interface Reader {
  readonly runs: ChangeRun[];
  baseLine: number;
  headline: number;
  isInHunk: boolean;
  /** The run being read: its removed and added lines so far. */
  open: { base: LineRange | undefined; head: LineRange | undefined } | undefined;
}

/**
 * The runs of changed lines in a file's unified diff (ADR 0123), in order: each is the removed
 * and added lines between two context lines (or a hunk's edge). Lines are numbered as the hunk
 * headers number them. Pure.
 */
export function changeRunsFrom(patch: string): ChangeRun[] {
  const reader: Reader = { runs: [], baseLine: 0, headline: 0, isInHunk: false, open: undefined };
  for (const text of patch.split('\n')) {
    readLine(reader, text);
  }
  closeRun(reader);
  return reader.runs;
}

function readLine(reader: Reader, text: string): void {
  const starts = hunkStartsFrom(text);
  if (starts !== undefined) {
    closeRun(reader);
    reader.baseLine = starts.base;
    reader.headline = starts.head;
    reader.isInHunk = true;
    return;
  }
  const marker = text[0];
  if (marker === '\\' || !reader.isInHunk) {
    return;
  }
  if (marker === '-') {
    reader.open ??= { base: undefined, head: undefined };
    reader.open.base = grown(reader.open.base, reader.baseLine);
    reader.baseLine += 1;
    return;
  }
  if (marker === '+') {
    reader.open ??= { base: undefined, head: undefined };
    reader.open.head = grown(reader.open.head, reader.headline);
    reader.headline += 1;
    return;
  }
  closeRun(reader);
  if (marker === ' ') {
    reader.baseLine += 1;
    reader.headline += 1;
    return;
  }
  reader.isInHunk = false;
}

function closeRun(reader: Reader): void {
  const { open } = reader;
  if (open === undefined) {
    return;
  }
  reader.runs.push({
    ...(open.head !== undefined && { head: open.head }),
    ...(open.base !== undefined && { base: open.base }),
    headAfter: reader.headline,
    removes: open.base !== undefined,
  });
  reader.open = undefined;
}

/** The first line each side of `@@ -a,b +c,d @@ …` covers, or `undefined` for any other line. */
function hunkStartsFrom(text: string): HunkStarts | undefined {
  if (!text.startsWith('@@ -')) {
    return undefined;
  }
  const [, baseSide = '', headSide = ''] = text.split(' ', 3);
  if (!headSide.startsWith('+')) {
    return undefined;
  }
  const base = firstLineOf(baseSide);
  const head = firstLineOf(headSide);
  if (base === undefined || head === undefined) {
    return undefined;
  }
  return { base, head };
}

/** `-a,b` or `+c,d`: an empty side (`b` is 0) names the line before its gap. */
function firstLineOf(side: string): number | undefined {
  const [start = '', count = '1'] = side.slice(1).split(',', 2);
  const first = Number(start);
  if (start === '' || !Number.isSafeInteger(first)) {
    return undefined;
  }
  if (count === '0') {
    return first + 1;
  }
  return first;
}

function grown(range: LineRange | undefined, line: number): LineRange {
  if (range === undefined) {
    return { start: line, end: line };
  }
  return { start: range.start, end: line };
}
