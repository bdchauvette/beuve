import type { UraItemView, UraSuggestionView } from '#contract/ipc-contract.ts';

import { describeSuggestionLines } from './describe-suggestion-lines.ts';
import { isOnNoteLines } from './is-on-note-lines.ts';

/** One suggestion of a note as the notes list previews it. */
export interface SuggestionPreview {
  readonly id: string;
  /** `path:Lstart–end`, raw (render it with `pathText`); absent when it is the note's own lines. */
  readonly heading?: string;
  /** The suggestion's own one-file unified diff, for `beuve-patch-preview`. */
  readonly patch: string;
}

/**
 * A note's suggestions, each previewed on its own (ADR 0162): its derived patch, or, when main
 * couldn't derive it, its replacement lines under a hunk-style header naming its lines. Each is
 * a separate patch, since joined ones read as one file's diff with the next file's header inside
 * it. Empty for a note without suggestions. Pure.
 */
export function suggestionPreviewsFrom(item: UraItemView): SuggestionPreview[] {
  return item.suggestions.map((suggestion): SuggestionPreview => {
    return {
      id: suggestion.id,
      ...(!isOnNoteLines(suggestion, item.anchor) && {
        heading: describeSuggestionLines(suggestion).heading,
      }),
      patch: patchOf(suggestion),
    };
  });
}

function patchOf(suggestion: UraSuggestionView): string {
  if (suggestion.patch !== undefined) {
    return suggestion.patch;
  }
  const { path, startLine, endLine, replacement } = suggestion;
  const lines = replacement.split('\n').map((line) => `+${line}`);
  if (replacement === '') {
    lines.length = 0;
  }
  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ lines ${String(startLine)}–${String(endLine)} @@`,
    ...lines,
    '',
  ].join('\n');
}
