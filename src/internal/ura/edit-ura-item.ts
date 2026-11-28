import type { Result } from '#x/result/result.ts';

import type { UraDeps, UraItem, UraItemError, UraSuggestionDraft } from './ura-item.ts';
import { uraSuggestionsFromDrafts } from './ura-suggestions-from-drafts.ts';
import type { UraSeverity } from './ura-severities.ts';
import { validateUraItem } from './validate-ura-item.ts';

/**
 * Fields a reviewer can change in the notes list. `suggestions` replaces them all (`[]` removes
 * them); a draft with the id of one the item has keeps that suggestion's identity.
 */
export interface UraItemEdit {
  readonly severity?: UraSeverity;
  readonly blocking?: boolean;
  readonly title?: string;
  readonly body?: string;
  readonly suggestions?: readonly UraSuggestionDraft[];
}

/** When the edit happens, and where new suggestions' ids come from. */
export interface UraEditContext {
  readonly now: Temporal.Instant;
  readonly deps: UraDeps;
}

/**
 * Applies a reviewer's edit. The anchor, origin and head an item was written against never
 * change; a different location is a different item.
 */
export function editUraItem(
  item: UraItem,
  edit: UraItemEdit,
  context: UraEditContext,
): Result<UraItem, UraItemError> {
  const { now, deps } = context;
  let suggestions = item.suggestions;
  if (edit.suggestions !== undefined) {
    suggestions = uraSuggestionsFromDrafts(
      { drafts: edit.suggestions, existing: item.suggestions },
      deps,
    );
  }
  return validateUraItem({
    ...item,
    severity: edit.severity ?? item.severity,
    blocking: edit.blocking ?? item.blocking,
    title: edit.title?.trim() ?? item.title,
    body: edit.body ?? item.body,
    suggestions,
    updatedAt: now.toString({ fractionalSecondDigits: 3 }),
  });
}
