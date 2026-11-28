import type { UraItemView } from '#contract/ipc-contract.ts';

import { anchorFromTarget } from './anchor-from-target.ts';
import { lineFromTarget } from './line-from-target.ts';
import { stagedNoteAt } from './staged-note-at.ts';
import type { SuggestionLines } from './suggestion-field-view.ts';
import type { ReviewTarget } from './target-from.ts';
import { unsuggestableReasonFrom } from './unsuggestable-reason-from.ts';

/**
 * Where Add Suggestion puts a field (ADR 0162): the head lines it is over, and the staged note it
 * is added to when the cursor is on one; or why there are no lines to suggest on.
 */
export type SuggestionTarget =
  | { readonly kind: 'lines'; readonly lines: SuggestionLines; readonly itemId?: string }
  | { readonly kind: 'refused'; readonly reason: string };

/**
 * What Add Suggestion takes from `target` (ADR 0063, 0162): the lines Add Note would stage, and,
 * when the target's head line (as Open in Editor takes it) lies on the anchor of a staged line
 * note written against the head being shown, that note. Notes from an older head are skipped:
 * their lines number a different file. A whole file, the whole change, and a deleted or binary
 * file have no lines to suggest on. Pure.
 */
export function suggestionTargetFrom(
  target: ReviewTarget,
  items: readonly UraItemView[],
  headSha: string,
): SuggestionTarget {
  if (target.kind === 'change') {
    return { kind: 'refused', reason: noLines };
  }
  const reason = unsuggestableReasonFrom(target.file);
  if (reason !== undefined) {
    return { kind: 'refused', reason };
  }
  const anchor = anchorFromTarget(target);
  const cursor = lineFromTarget(target);
  if (cursor === undefined || anchor.kind !== 'lines') {
    return { kind: 'refused', reason: noLines };
  }
  const { path, startLine, endLine } = anchor;
  const lines: SuggestionLines = { path, startLine, endLine };
  const item = stagedNoteAt(items, { path, line: cursor, headSha });
  if (item === undefined) {
    return { kind: 'lines', lines };
  }
  return { kind: 'lines', lines, itemId: item.id };
}

const noLines = 'Select head lines, or pick a hunk with Next Change, to add a suggestion.';
