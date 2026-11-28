import type { AutoeditSuggestionView } from '#contract/ipc-contract.ts';

import type { SuggestionFieldView } from './suggestion-field-view.ts';

/** What ✨ Autoedit changes in a note form: the body's text and the suggestion fields. */
export interface AutoeditForm {
  readonly body: string;
  /** Each field with the text it holds now as its `replacement`, in the form's order. */
  readonly fields: readonly SuggestionFieldView[];
}

/** What an autoedit answered: the new body and the suggestions it revised or added. */
export interface AutoeditAnswer {
  readonly body: string;
  readonly suggestions: readonly AutoeditSuggestionView[];
}

/** Where new fields go: the head their lines are on, and a key unused in the form. */
export interface AutoeditFieldOptions {
  readonly headSha: string;
  readonly newKey: () => string;
}

/**
 * The form an autoedit answer leaves (ADR 0125, amendment "Autoedit: body and suggestions"): its
 * body; each field the answer revised replaced by one with a fresh key (so the form builds a new
 * editor holding the revised text) that keeps the field's stored `id`, head and outdated reason; the fields it left out as
 * they are; and a field for each new suggestion, at the end. Nothing is removed. Keeping `before`
 * is what Undo autoedit restores. Pure.
 */
export function autoeditedFormFrom(
  before: AutoeditForm,
  answer: AutoeditAnswer,
  options: AutoeditFieldOptions,
): AutoeditForm {
  const revisions = new Map(
    answer.suggestions.flatMap((suggestion) => {
      if (suggestion.key === undefined) {
        return [];
      }
      return [[suggestion.key, suggestion] as const];
    }),
  );
  const fields = before.fields.map((field): SuggestionFieldView => {
    const revision = revisions.get(field.key);
    if (revision === undefined) {
      return field;
    }
    const { path, startLine, endLine, replacement } = revision;
    return {
      key: options.newKey(),
      ...(field.id !== undefined && { id: field.id }),
      headSha: field.headSha,
      path,
      startLine,
      endLine,
      replacement,
      ...(field.outdated !== undefined && { outdated: field.outdated }),
    };
  });
  const added = answer.suggestions
    .filter((suggestion) => suggestion.key === undefined)
    .map((suggestion): SuggestionFieldView => {
      const { path, startLine, endLine, replacement } = suggestion;
      return {
        key: options.newKey(),
        headSha: options.headSha,
        path,
        startLine,
        endLine,
        replacement,
      };
    });
  return { body: answer.body, fields: [...fields, ...added] };
}
