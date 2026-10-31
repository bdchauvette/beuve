import { isLspRange } from './is-lsp-range.ts';
import type { LspCallHierarchyItem, LspRange } from './lsp-protocol.ts';

/** An item and the ranges of the calls that connect it to the item it was expanded from. */
export interface LspCallHierarchyEdge {
  readonly item: LspCallHierarchyItem;
  readonly fromRanges: readonly LspRange[];
}

/**
 * Parses the result of `prepareCallHierarchy` (`items`) or of `incomingCalls`/`outgoingCalls`
 * (`edges`, where each entry's item is under `from` or `to`). Malformed entries are dropped; the
 * items keep every field so they can be sent back verbatim.
 */
export function parseCallHierarchyItems(
  value: unknown,
  shape: 'items' | 'from' | 'to',
): LspCallHierarchyEdge[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry: unknown) => {
    if (shape === 'items') {
      if (isCallHierarchyItem(entry)) {
        return { item: entry, fromRanges: [] };
      }
      return [];
    }
    if (typeof entry !== 'object' || entry === null) {
      return [];
    }
    const fields = entry as Readonly<Record<string, unknown>>;
    const item = fields[shape];
    if (!isCallHierarchyItem(item)) {
      return [];
    }
    const fromRanges = fields['fromRanges'];
    return {
      item,
      fromRanges: rangesFrom(fromRanges),
    };
  });
}

function rangesFrom(value: unknown): LspRange[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((range) => isLspRange(range));
}

function isCallHierarchyItem(value: unknown): value is LspCallHierarchyItem {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { name, kind, uri, range, selectionRange, detail } = value as Readonly<
    Record<string, unknown>
  >;
  return (
    typeof name === 'string' &&
    typeof kind === 'number' &&
    typeof uri === 'string' &&
    isLspRange(range) &&
    isLspRange(selectionRange) &&
    (detail === undefined || typeof detail === 'string')
  );
}
