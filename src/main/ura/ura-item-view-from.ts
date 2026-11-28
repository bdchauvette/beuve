import type {
  UraItemView,
  UraPlacementView,
  UraPostingView,
  UraSuggestionPlacementView,
  UraSuggestionView,
} from '#contract/ipc-contract.ts';
import type { UraHeadTexts } from '#internal/ura/compile-ura-artifact.ts';
import { isUraItemPosted } from '#internal/ura/is-ura-item-posted.ts';
import { suggestedPatchFrom } from '#internal/ura/suggested-patch-from.ts';
import type { UraItem } from '#internal/ura/ura-item.ts';
import type { UraPosting } from '#internal/ura/ura-posting.ts';

/** Where an item and its suggestions sit, the reviews that carried it, and its files. */
export interface UraItemViewContext {
  readonly placement: UraPlacementView;
  /** One per suggestion, in order; a missing one is placed like a suggestion on the item's head. */
  readonly suggestionPlacements?: readonly UraSuggestionPlacementView[];
  /** The session's postings; only the item's own are read. */
  readonly postings?: readonly UraPosting[];
  /** The files its suggestions name at its head; a suggestion without its file has no `patch`. */
  readonly headTexts?: UraHeadTexts | undefined;
}

/**
 * The URA domain's item as plain contract data, with where it and each suggestion sit on the
 * current head, the GitHub review that carried it once every piece of it was posted, and each
 * suggestion's derived patch (ADR 0162).
 */
export function uraItemViewFrom(
  item: UraItem,
  { placement, suggestionPlacements = [], postings = [], headTexts }: UraItemViewContext,
): UraItemView {
  const files = headTexts?.get(item.headSha);
  const posted = postedViewOf(item, postings);
  return {
    id: item.id,
    sessionId: item.sessionId,
    headSha: item.headSha,
    anchor: item.anchor,
    placement,
    severity: item.severity,
    blocking: item.blocking,
    origin: item.origin,
    title: item.title,
    body: item.body,
    suggestions: item.suggestions.map((suggestion, index): UraSuggestionView => {
      const { path, startLine, endLine } = suggestion;
      const view = {
        ...suggestion,
        placement: suggestionPlacements[index] ?? { kind: 'current', path, startLine, endLine },
      } as const;
      const text = files?.get(suggestion.path);
      if (text === undefined) {
        return view;
      }
      const patch = suggestedPatchFrom(text, suggestion);
      if (!patch.ok) {
        return view;
      }
      return { ...view, patch: patch.value };
    }),
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    ...(posted !== undefined && { posted }),
  };
}

/** The latest posting of the item once all its pieces were posted; `inline` when its text was. */
function postedViewOf(item: UraItem, postings: readonly UraPosting[]): UraPostingView | undefined {
  if (!isUraItemPosted(item, postings)) {
    return undefined;
  }
  const own = postings.filter((posting) => posting.itemId === item.id);
  const latest = own.at(-1);
  const note = own.find((posting) => posting.piece.kind === 'note');
  if (latest === undefined || note === undefined) {
    return undefined;
  }
  let placement: UraPostingView['placement'] = 'body';
  if (note.placement === 'comment') {
    placement = 'inline';
  }
  return { url: latest.url, placement, postedAt: latest.postedAt };
}
