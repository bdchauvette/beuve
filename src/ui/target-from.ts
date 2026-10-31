import type { DiffFileView } from '#contract/ipc-contract.ts';

import { findFirstChangedLine } from './find-first-changed-line.ts';
import type { HunkSpan } from './first-hunk-line.ts';
import { headNumberFromBase } from './head-number-from-base.ts';

/** A line range selected in a diff card, as `@pierre/diffs` reports it. */
export interface SelectedLines {
  readonly start: number;
  readonly end: number;
  readonly side?: 'additions' | 'deletions';
  readonly endSide?: 'additions' | 'deletions';
}

/** Lines `start`–`end` (1-based, inclusive, `start <= end`) of one side. */
export interface LineRange {
  readonly start: number;
  readonly end: number;
}

/**
 * What the reviewer points at in the diff stream (ADR 0063), the one answer every action
 * (Add Note, Add to Chat, Suggest Edit, Open in Editor, Show Callers, Show Control Flow, Run Trace Probe) adapts to what it needs:
 *
 * - `selection`: lines the reviewer selected, or a citation or find hit selected for them.
 *   `side` says which numbering `start`–`end` use: `base` when both ends are on deleted rows or
 *   the split view's left column, else `head` (a selection mixing both sides is mapped to head
 *   lines). `head` is the selection's head-side range, mapped from the base when needed;
 *   `undefined` only for a deleted file.
 * - `hunk`: the hunk Next/Previous Change stopped at. `head` is its head lines (`undefined` for a pure
 *   deletion), `base` its base lines (`undefined` for a pure addition) and `line` its first
 *   changed head line (for a deletion, the head line before the gap).
 * - `line`: one head line a jump landed on (a citation, a flow node, a trace line).
 * - `file`: the whole file; `line` is its first changed head line, if it has one.
 * - `change`: no file is active.
 */
export type ReviewTarget =
  | {
      readonly kind: 'selection';
      readonly file: DiffFileView;
      readonly side: 'head' | 'base';
      readonly start: number;
      readonly end: number;
      readonly head: LineRange | undefined;
    }
  | {
      readonly kind: 'hunk';
      readonly file: DiffFileView;
      readonly index: number;
      readonly head: LineRange | undefined;
      readonly base: LineRange | undefined;
      readonly line: number;
    }
  | { readonly kind: 'line'; readonly file: DiffFileView; readonly line: number }
  | { readonly kind: 'file'; readonly file: DiffFileView; readonly line: number | undefined }
  | { readonly kind: 'change' };

/** The cursor state of the active card that {@link targetFrom} reads. */
export interface TargetState {
  /** The active card's file; `undefined` when no file is active. */
  readonly file: DiffFileView | undefined;
  /** The hunk Next/Previous Change stopped at; `-1` for none. */
  readonly hunk: number;
  /** The reviewer's own selection (not the one Next/Previous Change draws). */
  readonly selection: SelectedLines | undefined;
  /** The head line the last jump landed on. */
  readonly line: number | undefined;
  /** A collapsed card (ADR 0052) shows no lines, so only the file can be targeted. */
  readonly collapsed: boolean;
}

/**
 * Which lines the reviewer means. Precedence: no active file → `change`; a collapsed card →
 * `file` (a stale selection or hunk is not on screen); a selection → `selection`; a jump's line
 * → `line`; a focused hunk → `hunk`; otherwise `file`. Pure.
 */
export function targetFrom(state: TargetState): ReviewTarget {
  const { file } = state;
  if (file === undefined) {
    return { kind: 'change' };
  }
  const whole: ReviewTarget = { kind: 'file', file, line: findFirstChangedLine(file.patch) };
  if (state.collapsed) {
    return whole;
  }
  if (state.selection !== undefined) {
    return selectionTarget(file, state.selection);
  }
  if (state.line !== undefined) {
    return { kind: 'line', file, line: Math.max(1, state.line) };
  }
  const hunk = file.hunks[state.hunk];
  if (hunk === undefined) {
    return whole;
  }
  return {
    kind: 'hunk',
    file,
    index: state.hunk,
    head: rangeOf({ start: hunk.newStart, count: hunk.newCount }),
    base: rangeOf({ start: hunk.oldStart, count: hunk.oldCount }),
    line: Math.max(1, findFirstChangedLine(file.patch, state.hunk) ?? hunk.newStart),
  };
}

/** The lines a hunk side covers; `undefined` for an empty side. */
function rangeOf(span: HunkSpan): LineRange | undefined {
  if (span.count === 0) {
    return undefined;
  }
  return { start: span.start, end: span.start + span.count - 1 };
}

function selectionTarget(file: DiffFileView, selection: SelectedLines): ReviewTarget {
  const startSide = selection.side ?? 'additions';
  const endSide = selection.endSide ?? startSide;
  const headOf = (line: number, side: 'additions' | 'deletions'): number | undefined => {
    if (side === 'additions') {
      return Math.max(1, line);
    }
    return headNumberFromBase(file, Math.max(1, line));
  };
  const first = headOf(selection.start, startSide);
  const last = headOf(selection.end, endSide);
  const head = rangeBetween(first, last);
  const isBase = startSide === 'deletions' && endSide === 'deletions';
  if (isBase) {
    const start = Math.max(1, Math.min(selection.start, selection.end));
    return {
      kind: 'selection',
      file,
      side: 'base',
      start,
      end: Math.max(start, selection.start, selection.end),
      head,
    };
  }
  const range = head ?? { start: 1, end: 1 };
  return { kind: 'selection', file, side: 'head', start: range.start, end: range.end, head: range };
}

/** The lines from `first` to `last` in either order; `undefined` when either end has no line. */
function rangeBetween(first: number | undefined, last: number | undefined): LineRange | undefined {
  if (first === undefined || last === undefined) {
    return undefined;
  }
  return { start: Math.min(first, last), end: Math.max(first, last) };
}
