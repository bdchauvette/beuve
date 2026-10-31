import { isLspRange } from './is-lsp-range.ts';
import type { LspDocumentSymbol } from './lsp-protocol.ts';

/**
 * Parses a `documentSymbol` result. Hierarchical `DocumentSymbol[]` is kept as is; flat
 * `SymbolInformation[]` becomes childless symbols whose range is also their selection range.
 */
export function parseDocumentSymbols(value: unknown): LspDocumentSymbol[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry: unknown) => {
    const symbol = parseSymbol(entry);
    if (symbol === undefined) {
      return [];
    }
    return [symbol];
  });
}

function parseSymbol(value: unknown): LspDocumentSymbol | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const { name, kind, detail, range, selectionRange, children, location } = value as Readonly<
    Record<string, unknown>
  >;
  if (typeof name !== 'string' || typeof kind !== 'number') {
    return undefined;
  }
  const detailField = detailFrom(detail);
  if (isLspRange(range) && isLspRange(selectionRange)) {
    return {
      name,
      kind,
      ...detailField,
      range,
      selectionRange,
      children: parseDocumentSymbols(children),
    };
  }
  if (typeof location === 'object' && location !== null && 'range' in location) {
    const locationRange = location.range;
    if (isLspRange(locationRange)) {
      return {
        name,
        kind,
        ...detailField,
        range: locationRange,
        selectionRange: locationRange,
        children: [],
      };
    }
  }
  return undefined;
}

function detailFrom(detail: unknown): Pick<LspDocumentSymbol, 'detail'> {
  if (typeof detail === 'string') {
    return { detail };
  }
  return {};
}
