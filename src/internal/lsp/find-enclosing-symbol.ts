import type { DocumentSymbolView } from './lsp-model.ts';

const callableKinds = new Set(['function', 'method', 'constructor']);

/**
 * The innermost function, method or constructor whose range contains 0-based `line`, e.g. to
 * turn a hunk line into the position for `prepareCallHierarchy` (its `selectionRange.start`).
 */
export function findEnclosingSymbol(
  symbols: readonly DocumentSymbolView[],
  line: number,
): DocumentSymbolView | undefined {
  for (const symbol of symbols) {
    if (line < symbol.range.start.line || line > symbol.range.end.line) {
      continue;
    }
    const inner = findEnclosingSymbol(symbol.children, line);
    if (inner !== undefined) {
      return inner;
    }
    if (callableKinds.has(symbol.kind)) {
      return symbol;
    }
  }
  return undefined;
}
