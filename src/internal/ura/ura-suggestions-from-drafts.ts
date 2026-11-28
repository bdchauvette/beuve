import type { UraDeps, UraSuggestion, UraSuggestionDraft, UraSuggestionId } from './ura-item.ts';

/** The suggestions a caller sends, and the ones the item has now. */
export interface UraSuggestionDrafts {
  readonly drafts: readonly UraSuggestionDraft[];
  /** None for a new item. */
  readonly existing: readonly UraSuggestion[];
}

/**
 * Gives each draft its identity (ADR 0162): a draft carrying the id of one of `existing` is that
 * suggestion, edited in place; any other draft (no id, an id the item doesn't have, or one an
 * earlier draft already took) is a new suggestion with a fresh id from `deps`. So a suggestion
 * keeps its postings across edits however the list around it changes.
 */
export function uraSuggestionsFromDrafts(
  { drafts, existing }: UraSuggestionDrafts,
  deps: UraDeps,
): UraSuggestion[] {
  const known = new Set<string>(existing.map((suggestion) => suggestion.id));
  const taken = new Set<string>();
  return drafts.map(({ id, path, startLine, endLine, replacement }): UraSuggestion => {
    if (id !== undefined && known.has(id) && !taken.has(id)) {
      taken.add(id);
      return { id: id as UraSuggestionId, path, startLine, endLine, replacement };
    }
    return { id: deps.newId() as UraSuggestionId, path, startLine, endLine, replacement };
  });
}
