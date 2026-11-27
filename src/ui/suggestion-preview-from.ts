import type { UraItemView, UraSuggestionView } from '#contract/ipc-contract.ts';

/**
 * A note's suggestions as one unified diff to preview (ADR 0162): each one's derived patch, or,
 * when main couldn't derive it, its replacement lines under a hunk-style header naming its lines.
 * `undefined` for a note without suggestions.
 */
export function suggestionPreviewFrom(item: UraItemView): string | undefined {
  if (item.suggestions.length === 0) {
    return undefined;
  }
  return item.suggestions.map((suggestion) => previewOf(suggestion)).join('');
}

function previewOf(suggestion: UraSuggestionView): string {
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
