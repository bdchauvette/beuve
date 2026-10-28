import type { UraItemView, UraPlacementView } from '#contract/ipc-contract.ts';
import type { UraItem } from '#internal/ura/ura-item.ts';

/** The URA domain's item as plain contract data, with where it sits on the current head. */
export function toUraItemView(item: UraItem, placement: UraPlacementView): UraItemView {
  return {
    id: item.id,
    sessionId: item.sessionId,
    headSha: item.headSha,
    anchor: item.anchor,
    placement,
    severity: item.severity,
    origin: item.origin,
    title: item.title,
    body: item.body,
    ...(item.suggestion !== undefined && { suggestedPatch: item.suggestion.text }),
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}
