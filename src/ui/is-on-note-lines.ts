import type { UraAnchorView } from '#contract/ipc-contract.ts';

import type { SuggestionLines } from './suggestion-field-view.ts';

/**
 * Whether a suggestion is over exactly the lines its note is anchored on (ADR 0162), so its
 * field's `path:Lstart–end` would repeat the note's own. A file or whole-change note, or a note
 * without an anchor, has no lines for it to repeat. Pure.
 */
export function isOnNoteLines(lines: SuggestionLines, anchor: UraAnchorView | undefined): boolean {
  return (
    anchor?.kind === 'lines' &&
    anchor.path === lines.path &&
    anchor.startLine === lines.startLine &&
    anchor.endLine === lines.endLine
  );
}
