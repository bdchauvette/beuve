import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { findEnclosingSymbol } from './find-enclosing-symbol.ts';
import type { DocumentSymbolView } from './lsp-model.ts';

/** A symbol spanning lines `start` to `end`. */
interface TestSymbol {
  readonly name: string;
  readonly kind: string;
  readonly start: number;
  readonly end: number;
}

function symbol(
  { name, kind, start, end }: TestSymbol,
  children: DocumentSymbolView[] = [],
): DocumentSymbolView {
  const range = { start: { line: start, character: 0 }, end: { line: end, character: 1 } };
  return { name, kind, detail: undefined, range, selectionRange: range, children };
}

describe('findEnclosingSymbol', () => {
  const symbols = [
    symbol({ name: 'Widget', kind: 'class', start: 0, end: 20 }, [
      symbol({ name: 'constructor', kind: 'constructor', start: 1, end: 3 }),
      symbol({ name: 'render', kind: 'method', start: 5, end: 12 }, [
        symbol({ name: 'inner', kind: 'function', start: 7, end: 9 }),
      ]),
    ]),
    symbol({ name: 'helper', kind: 'function', start: 22, end: 30 }),
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
