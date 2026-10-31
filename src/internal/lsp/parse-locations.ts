import { isLspRange } from './is-lsp-range.ts';
import type { LspLocation } from './lsp-protocol.ts';

/**
 * Parses a definition or references result: `null`, a `Location`, `Location[]` or `LocationLink[]`
 * (whose `targetSelectionRange` is used). Malformed entries are dropped.
 */
export function parseLocations(value: unknown): LspLocation[] {
  const entries: unknown[] = [value].flat();
  return entries.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) {
      return [];
    }
    const { uri, range, targetUri, targetSelectionRange } = entry as Readonly<
      Record<string, unknown>
    >;
    if (typeof uri === 'string' && isLspRange(range)) {
      return { uri, range };
    }
    if (typeof targetUri === 'string' && isLspRange(targetSelectionRange)) {
      return { uri: targetUri, range: targetSelectionRange };
    }
    return [];
  });
}
