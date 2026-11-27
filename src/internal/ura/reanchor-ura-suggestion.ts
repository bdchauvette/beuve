import type { FileLineMapping } from './line-mapping.ts';
import { reanchorUraAnchor } from './reanchor-ura-anchor.ts';
import type { UraAnchor, UraSuggestionRange } from './ura-item.ts';

/** A suggestion moved to the later head, or the reason it can't be. */
export type ReanchoredSuggestion<S extends UraSuggestionRange = UraSuggestionRange> =
  | { readonly kind: 'current'; readonly suggestion: S }
  | { readonly kind: 'outdated'; readonly reason: 'lines-changed' | 'file-deleted' };

/**
 * Maps a suggestion written against an older head onto a later one as `reanchorUraAnchor` maps a
 * line anchor (ADR 0162): its lines follow the file and are outdated when any of them changed. An
 * insertion follows the line before it, and an insertion at the top of the file only its file.
 * Everything but its path and lines (its id, its replacement) is kept.
 */
export function reanchorUraSuggestion<S extends UraSuggestionRange>(
  suggestion: S,
  files: readonly FileLineMapping[],
): ReanchoredSuggestion<S> {
  const { path, startLine, endLine } = suggestion;
  const isInsertion = endLine === startLine - 1;
  let anchor: UraAnchor = { kind: 'lines', path, startLine, endLine };
  if (isInsertion && startLine === 1) {
    anchor = { kind: 'file', path };
  } else if (isInsertion) {
    anchor = { kind: 'lines', path, startLine: endLine, endLine };
  }
  const moved = reanchorUraAnchor(anchor, files);
  if (moved.kind === 'outdated') {
    return moved;
  }
  const placed = moved.anchor;
  if (placed.kind === 'file') {
    return { kind: 'current', suggestion: { ...suggestion, path: placed.path } };
  }
  if (placed.kind === 'change') {
    return { kind: 'current', suggestion };
  }
  if (isInsertion) {
    return {
      kind: 'current',
      suggestion: {
        ...suggestion,
        path: placed.path,
        startLine: placed.endLine + 1,
        endLine: placed.endLine,
      },
    };
  }
  return {
    kind: 'current',
    suggestion: {
      ...suggestion,
      path: placed.path,
      startLine: placed.startLine,
      endLine: placed.endLine,
    },
  };
}
