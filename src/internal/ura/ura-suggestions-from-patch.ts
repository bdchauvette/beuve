import { changeRegionsFrom } from './change-regions-from.ts';
import type { SuggestedPatch, UraSuggestion } from './ura-item.ts';

/**
 * A suggested patch as suggestions (ADR 0162): each hunk that changes something becomes one
 * suggestion over its old range, whose replacement is the hunk's new side (its context and added
 * lines). A hunk whose new side is a single empty line and nothing else reads as a deletion, since
 * a replacement of `''` is no lines; hunks with context lines never are.
 */
export function uraSuggestionsFromPatch(patch: SuggestedPatch): UraSuggestion[] {
  return patch.hunks
    .filter((hunk) => changeRegionsFrom(hunk).length > 0)
    .map((hunk): UraSuggestion => {
      let startLine = hunk.oldStart;
      if (hunk.oldCount === 0) {
        startLine += 1;
      }
      const replacement = hunk.lines
        .filter((line) => line.kind !== 'removed')
        .map((line) => line.content)
        .join('\n');
      return {
        path: patch.path,
        startLine,
        endLine: startLine + hunk.oldCount - 1,
        replacement,
      };
    });
}
