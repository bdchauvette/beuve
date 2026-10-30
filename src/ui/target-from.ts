import type { DiffFileView } from '#contract/ipc-contract.ts';

import { findFirstChangedLine } from './find-first-changed-line.ts';
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
 * (`m`, ⌘>, `e`, `o`, `p`, `Shift+p`, `r`) adapts to what it needs:
 *
 * - `selection`: lines the reviewer selected, or a citation or find hit selected for them.
 *   `side` says which numbering `start`–`end` use: `base` when both ends are on deleted rows or
 *   the split view's left column, else `head` (a selection mixing both sides is mapped to head
 *   lines). `head` is the selection's head-side range, mapped from the base when needed;
 *   `undefined` only for a deleted file.
 * - `hunk`: the hunk `j`/`k` stopped at. `head` is its head lines (`undefined` for a pure
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
  /** The hunk `j`/`k` stopped at; `-1` for none. */
  readonly hunk: number;
  /** The reviewer's own selection (not the one `j`/`k` draws). */
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
    head:
      hunk.newCount === 0
        ? undefined
        : { start: hunk.newStart, end: hunk.newStart + hunk.newCount - 1 },
    base:
      hunk.oldCount === 0
        ? undefined
        : { start: hunk.oldStart, end: hunk.oldStart + hunk.oldCount - 1 },
    line: Math.max(1, findFirstChangedLine(file.patch, state.hunk) ?? hunk.newStart),
  };
}

function selectionTarget(file: DiffFileView, selection: SelectedLines): ReviewTarget {
  const startSide = selection.side ?? 'additions';
  const endSide = selection.endSide ?? startSide;
  const headOf = (line: number, side: 'additions' | 'deletions'): number | undefined =>
    side === 'additions' ? Math.max(1, line) : headNumberFromBase(file, Math.max(1, line));
  const first = headOf(selection.start, startSide);
  const last = headOf(selection.end, endSide);
  const head =
    first === undefined || last === undefined
      ? undefined
      : { start: Math.min(first, last), end: Math.max(first, last) };
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
