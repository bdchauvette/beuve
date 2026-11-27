import type { SuggestionFieldView, SuggestionLines } from './suggestion-field-view.ts';

/** The fields with one more, or the field already on some of its lines. */
export type SuggestionFieldsChange =
  | { readonly kind: 'added'; readonly fields: readonly SuggestionFieldView[] }
  | { readonly kind: 'overlaps'; readonly field: SuggestionFieldView };

/**
 * `fields` with `field` added at the end, unless it overlaps one of them as the domain rules out
 * (ADR 0162, `validateUraItem`): two fields on one path share a line, insert at the same place, or
 * one inserts between the other's lines. An insertion right before or after a field's lines only
 * touches it. Pure.
 */
export function withSuggestionField(
  fields: readonly SuggestionFieldView[],
  field: SuggestionFieldView,
): SuggestionFieldsChange {
  const overlapping = fields.find((existing) => isOverlapping(existing, field));
  if (overlapping !== undefined) {
    return { kind: 'overlaps', field: overlapping };
  }
  return { kind: 'added', fields: [...fields, field] };
}

function isOverlapping(a: SuggestionLines, b: SuggestionLines): boolean {
  if (a.path !== b.path) {
    return false;
  }
  const isInsertion = (lines: SuggestionLines): boolean => lines.endLine === lines.startLine - 1;
  if (isInsertion(a) && isInsertion(b)) {
    return a.startLine === b.startLine;
  }
  if (isInsertion(a)) {
    return b.startLine < a.startLine && a.startLine <= b.endLine;
  }
  if (isInsertion(b)) {
    return a.startLine < b.startLine && b.startLine <= a.endLine;
  }
  return a.startLine <= b.endLine && b.startLine <= a.endLine;
}
