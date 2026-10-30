import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { findEnclosingSymbol } from './find-enclosing-symbol.ts';
import type { DocumentSymbolView } from './lsp-model.ts';

function symbol(
  name: string,
  kind: string,
  start: number,
  end: number,
  children: DocumentSymbolView[] = [],
): DocumentSymbolView {
  const range = { start: { line: start, character: 0 }, end: { line: end, character: 1 } };
  return { name, kind, detail: undefined, range, selectionRange: range, children };
}

describe('findEnclosingSymbol', () => {
  const symbols = [
    symbol('Widget', 'class', 0, 20, [
      symbol('constructor', 'constructor', 1, 3),
      symbol('render', 'method', 5, 12, [symbol('inner', 'function', 7, 9)]),
    ]),
    symbol('helper', 'function', 22, 30),
  ];

  test('returns the innermost callable containing the line', ({ expect }) => {
    expect(findEnclosingSymbol(symbols, 8)?.name).toBe('inner');
    expect(findEnclosingSymbol(symbols, 11)?.name).toBe('render');
    expect(findEnclosingSymbol(symbols, 25)?.name).toBe('helper');
  });

  test('skips non-callables and lines outside every symbol', ({ expect }) => {
    expect(findEnclosingSymbol(symbols, 15)).toBeUndefined();
    expect(findEnclosingSymbol(symbols, 21)).toBeUndefined();
  });
});
