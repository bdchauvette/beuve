import type { SheetRangeView } from '#contract/ipc-contract.ts';

/** One place a sheet showed: a file at the sheet's commit, and the range it highlighted. */
export interface SheetPlace {
  readonly path: string;
  readonly range: SheetRangeView | undefined;
}

/** A sheet's back/forward history (ADR 0067); `index` is the place on screen. */
export interface SheetHistory {
  readonly places: readonly SheetPlace[];
  readonly index: number;
}

export type SheetHistoryStep =
  | { readonly kind: 'visit'; readonly place: SheetPlace }
  | { readonly kind: 'back' }
  | { readonly kind: 'forward' };

/** Places kept per sheet; the oldest drop off first. */
const maxPlaces = 100;

/**
 * Moves a sheet's history like a browser's: visiting drops anything forward of the current place
 * and appends (a visit to the place already shown changes nothing), back and forward move within
 * bounds and are no-ops at either end. Returns the same object when nothing changes. Pure.
 */
export function stepSheetHistory(history: SheetHistory, step: SheetHistoryStep): SheetHistory {
  switch (step.kind) {
    case 'visit': {
      const current = history.places[history.index];
      if (current !== undefined && isSamePlace(current, step.place)) {
        return history;
      }
      const places = [...history.places.slice(0, history.index + 1), step.place].slice(-maxPlaces);
      return { places, index: places.length - 1 };
    }
    case 'back': {
      return history.index > 0 ? { ...history, index: history.index - 1 } : history;
    }
    case 'forward': {
      return history.index < history.places.length - 1
        ? { ...history, index: history.index + 1 }
        : history;
    }
  }
}

function isSamePlace(left: SheetPlace, right: SheetPlace): boolean {
  return (
    left.path === right.path &&
    left.range?.startLine === right.range?.startLine &&
    left.range?.startCharacter === right.range?.startCharacter &&
    left.range?.endLine === right.range?.endLine &&
    left.range?.endCharacter === right.range?.endCharacter
  );
}
