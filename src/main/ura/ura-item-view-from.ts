import type { UraItemView, UraPlacementView } from '#contract/ipc-contract.ts';
import type { UraItem } from '#internal/ura/ura-item.ts';
import type { UraPosting } from '#internal/ura/ura-posting.ts';

/**
 * The URA domain's item as plain contract data, with where it sits on the current head and the
 * GitHub review that carried it, if one did.
 */
export function uraItemViewFrom(
  item: UraItem,
  placement: UraPlacementView,
  posting?: UraPosting,
): UraItemView {
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
    ...(item.suggestion !== undefined && { suggestedPatch: item.suggestion.text }),
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    ...(posting !== undefined && {
      posted: { url: posting.url, placement: posting.placement, postedAt: posting.postedAt },
    }),
  };
}
