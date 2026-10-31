import type { DiffHunkView } from '#contract/ipc-contract.ts';

/** Anything with a 1-based, inclusive head-side line range. */
export interface HeadSideRange {
  readonly lineStart: number;
  readonly lineEnd: number;
}

/**
 * Which unchanged lines `FileDiff.expandHunk` reveals: the gap before hunk `gap` (the gap after
 * the last hunk is `hunks.length`), `lines` lines from its start (`up`) or its end (`down`), as
 * the library's separator buttons do.
 */
export interface HunkExpansion {
  readonly gap: number;
  readonly direction: 'up' | 'down';
  readonly lines: number;
}

/** What the diff shows and the context lines the reviewer revealed for notes. */
export interface ShownLines {
  readonly hunks: readonly DiffHunkView[];
  readonly revealed: readonly HeadSideRange[];
}

/**
 * Where a note sits on a card (ADR 0025, 0027): `shown`, after the last head line of its range
 * that the diff shows; or `hidden`, when none is, after the last head line above the collapsed
 * gap that holds the range's end (0: above the first hunk), with the expansion that shows it.
 */
export type NotePlacement =
  | { readonly kind: 'shown'; readonly after: number }
  | { readonly kind: 'hidden'; readonly after: number; readonly expansion: HunkExpansion };

/**
 * Places a note's head lines on the diff. Every head line of a hunk is shown (context or added),
 * and so is a range the reviewer revealed; a whole-file note (line 0) sits above the first hunk.
 * Pure.
 */
export function placeNoteOnDiff(shown: ShownLines, range: HeadSideRange): NotePlacement {
  if (range.lineEnd === 0) {
    return { kind: 'shown', after: 0 };
  }
  const after = lastShownLine(shown, range);
  if (after !== undefined) {
    return { kind: 'shown', after };
  }
  return hiddenPlacement(shown.hunks, range);
}

function lastShownLine(shown: ShownLines, range: HeadSideRange): number | undefined {
  let last: number | undefined;
  const spans = [...shown.hunks.map((hunk) => headSpanOf(hunk)), ...shown.revealed];
  for (const span of spans) {
    if (
      span.lineEnd < span.lineStart ||
      range.lineEnd < span.lineStart ||
      range.lineStart > span.lineEnd
    ) {
      continue;
    }
    last = Math.max(last ?? 0, Math.min(range.lineEnd, span.lineEnd));
  }
  return last;
}

/** A hunk's head lines; a pure deletion has none, and sits after line `newStart`. */
function headSpanOf(hunk: DiffHunkView): HeadSideRange {
  if (hunk.newCount === 0) {
    return { lineStart: hunk.newStart + 1, lineEnd: hunk.newStart };
  }
  return { lineStart: hunk.newStart, lineEnd: hunk.newStart + hunk.newCount - 1 };
}

function hiddenPlacement(hunks: readonly DiffHunkView[], range: HeadSideRange): NotePlacement {
  let after = 0;
  for (const [gap, hunk] of hunks.entries()) {
    const span = headSpanOf(hunk);
    if (range.lineEnd < span.lineStart) {
      const lines = { lineStart: after + 1, lineEnd: span.lineStart - 1 };
      return { kind: 'hidden', after, expansion: expansionInGap({ gap, lines }, range) };
    }
    after = span.lineEnd;
  }
  const lines = range.lineEnd - after;
  return { kind: 'hidden', after, expansion: { gap: hunks.length, direction: 'up', lines } };
}

/** A collapsed gap between hunks: the one before hunk `gap`, and its head lines. */
interface Gap {
  readonly gap: number;
  readonly lines: HeadSideRange;
}

/** The smaller of revealing the range from the gap's start or from its end. */
function expansionInGap({ gap, lines }: Gap, range: HeadSideRange): HunkExpansion {
  const fromStart = range.lineEnd - lines.lineStart + 1;
  const fromEnd = lines.lineEnd - Math.max(range.lineStart, lines.lineStart) + 1;
  if (fromEnd <= fromStart) {
    return { gap, direction: 'down', lines: fromEnd };
  }
  return { gap, direction: 'up', lines: fromStart };
}
