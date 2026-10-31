import type { UraItemView } from '#contract/ipc-contract.ts';

/** A staged item placed on a file of the current head, as the card annotates it. */
export interface UraMarker {
  /** 0 for a whole-file note, which the card shows above the first hunk. */
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly item: UraItemView;
}

/**
 * The markers a file card shows (ADR 0027): staged items whose current placement is on `path`,
 * in dock order. Outdated, withdrawn and addressed items, and whole-change notes, get none.
 */
export function uraMarkersFrom(path: string, items: readonly UraItemView[]): UraMarker[] {
  return items.flatMap((item): UraMarker[] => {
    const { placement } = item;
    if (item.status.kind !== 'staged' || placement.kind !== 'current') {
      return [];
    }
    const { anchor } = placement;
    if (anchor.kind === 'lines' && anchor.path === path) {
      return [{ lineStart: anchor.startLine, lineEnd: anchor.endLine, item }];
    }
    if (anchor.kind === 'file' && anchor.path === path) {
      return [{ lineStart: 0, lineEnd: 0, item }];
    }
    return [];
  });
}
