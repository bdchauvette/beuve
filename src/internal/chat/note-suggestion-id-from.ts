/**
 * How a drafting prompt names the draft's suggestion at `index` (ADR 0125's amendment "Autoedit:
 * body and suggestions"): s1, s2, …; an answer refers to a suggestion it revises by this id. Pure.
 */
export function noteSuggestionIdFrom(index: number): string {
  return `s${String(index + 1)}`;
}
