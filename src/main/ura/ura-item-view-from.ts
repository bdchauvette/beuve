import type { UraItemView, UraPlacementView, UraSuggestionView } from '#contract/ipc-contract.ts';
import type { UraHeadTexts } from '#internal/ura/compile-ura-artifact.ts';
import { suggestedPatchFrom } from '#internal/ura/suggested-patch-from.ts';
import type { UraItem } from '#internal/ura/ura-item.ts';
import type { UraPosting } from '#internal/ura/ura-posting.ts';

/** Where an item sits, the review that carried it, and the files its patches derive from. */
export interface UraItemViewContext {
  readonly placement: UraPlacementView;
  readonly posting?: UraPosting | undefined;
  /** The files its suggestions name at its head; a suggestion without its file has no `patch`. */
  readonly headTexts?: UraHeadTexts | undefined;
}

/**
 * The URA domain's item as plain contract data, with where it sits on the current head, the
 * GitHub review that carried it, if one did, and each suggestion's derived patch (ADR 0162).
 */
export function uraItemViewFrom(
  item: UraItem,
  { placement, posting, headTexts }: UraItemViewContext,
): UraItemView {
  const files = headTexts?.get(item.headSha);
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
    suggestions: item.suggestions.map((suggestion): UraSuggestionView => {
      const text = files?.get(suggestion.path);
      if (text === undefined) {
        return suggestion;
      }
      const patch = suggestedPatchFrom(text, suggestion);
      if (!patch.ok) {
        return suggestion;
      }
      return { ...suggestion, patch: patch.value };
    }),
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    ...(posting !== undefined && {
      posted: { url: posting.url, placement: posting.placement, postedAt: posting.postedAt },
    }),
  };
}
