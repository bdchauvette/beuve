import { parseSuggestedPatch } from '../parse-suggested-patch.ts';
import type { UraEntry, UraPlacedSuggestion, UraPlacement } from '../ura-artifact.ts';
import type { PatchHunk, UraItem, UraSuggestion } from '../ura-item.ts';
import { uraSuggestionsFromPatch } from '../ura-suggestions-from-patch.ts';

import { testUraIds } from './test-ura-ids.ts';

/** An artifact entry to build: the item, where it sits, and a patch its suggestions come from. */
export interface TestEntrySource {
  readonly item: UraItem;
  readonly placement: UraPlacement;
  /** A unified diff (bare hunks are fine) for the item's anchored path; one suggestion per hunk. */
  readonly patch?: string;
}

/**
 * An entry as `compileUraArtifact` would build it: the patch's hunks become the item's
 * suggestions (`uraSuggestionsFromPatch`), each placed like the item and carrying its hunk as its
 * derived patch. Throws on a patch that doesn't parse, so tests fail loudly on a bad fixture.
 */
export function createTestEntry({ item, placement, patch }: TestEntrySource): UraEntry {
  if (patch === undefined) {
    return { item, placement, suggestions: [] };
  }
  const parsed = parseSuggestedPatch(patch, item.anchor);
  if (!parsed.ok) {
    throw new Error(`invalid test patch: ${parsed.error.reason}`);
  }
  const { path, hunks } = parsed.value;
  const suggestions = uraSuggestionsFromPatch(parsed.value).map((range, index): UraSuggestion => {
    return { id: testUraIds.suggestionId(index + 1), ...range };
  });
  const placed = suggestions.map((suggestion, index): UraPlacedSuggestion => {
    const hunk = hunks[index];
    let text: string | undefined;
    if (hunk !== undefined) {
      text = `--- a/${path}\n+++ b/${path}\n${hunkText(hunk)}`;
    }
    if (hunks.length === 1) {
      text = parsed.value.text;
    }
    if (placement.kind === 'outdated') {
      return {
        suggestion,
        placement: { kind: 'outdated', reason: placement.reason },
        ...(text !== undefined && { patch: text }),
      };
    }
    return {
      suggestion,
      placement: { kind: 'current', suggestion },
      ...(text !== undefined && { patch: text }),
    };
  });
  return { item: { ...item, suggestions }, placement, suggestions: placed };
}

function hunkText(hunk: PatchHunk): string {
  const prefixes = { context: ' ', added: '+', removed: '-' } as const;
  const header = `@@ -${String(hunk.oldStart)},${String(hunk.oldCount)} +${String(hunk.newStart)},${String(hunk.newCount)} @@`;
  const lines = hunk.lines.map((line) => `${prefixes[line.kind]}${line.content}`);
  return `${[header, ...lines].join('\n')}\n`;
}
