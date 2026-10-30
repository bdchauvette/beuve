import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import type { LspRange } from './lsp-protocol.ts';
import { parseDocumentSymbols } from './parse-document-symbols.ts';

function range(): LspRange {
  return { start: { line: 0, character: 0 }, end: { line: 2, character: 1 } };
}

describe('parseDocumentSymbols', () => {
  test('keeps hierarchical symbols and flattens symbol information', ({ expect }) => {
    expect(
      parseDocumentSymbols([
        {
          name: 'C',
          kind: 5,
          range: range(),
          selectionRange: range(),
          children: [{ name: 'm', kind: 6, range: range(), selectionRange: range() }],
        },
        { name: 'f', kind: 12, location: { uri: 'file:///a.ts', range: range() } },
        { name: 'bad' },
      ]),
    ).toStrictEqual([
      {
        name: 'C',
        kind: 5,
        range: range(),
        selectionRange: range(),
        children: [{ name: 'm', kind: 6, range: range(), selectionRange: range(), children: [] }],
      },
      { name: 'f', kind: 12, range: range(), selectionRange: range(), children: [] },
    ]);
  });
});
