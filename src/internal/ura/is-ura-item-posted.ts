import type { UraItem } from './ura-item.ts';
import type { UraPosting } from './ura-posting.ts';

/**
 * Whether posted reviews carried every piece of the item (ADR 0162): its text and each of its
 * suggestions, wherever each went. `postings` may hold other items' postings.
 */
export function isUraItemPosted(
  item: Pick<UraItem, 'id' | 'suggestions'>,
  postings: readonly Pick<UraPosting, 'itemId' | 'piece'>[],
): boolean {
  const own = postings.filter((posting) => posting.itemId === item.id);
  if (own.every((posting) => posting.piece.kind !== 'note')) {
    return false;
  }
  const posted = new Set<string>();
  for (const { piece } of own) {
    if (piece.kind === 'suggestion') {
      posted.add(piece.suggestionId);
    }
  }
  return item.suggestions.every((suggestion) => posted.has(suggestion.id));
}
