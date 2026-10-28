import { describe, expect, it } from 'vitest';

import { parseDocumentSymbols } from './parse-document-symbols.ts';

const range = { start: { line: 0, character: 0 }, end: { line: 2, character: 1 } };

describe('parseDocumentSymbols', () => {
  it('keeps hierarchical symbols and flattens symbol information', () => {
    expect(
      parseDocumentSymbols([
        {
          name: 'C',
          kind: 5,
          range,
          selectionRange: range,
          children: [{ name: 'm', kind: 6, range, selectionRange: range }],
        },
        { name: 'f', kind: 12, location: { uri: 'file:///a.ts', range } },
        { name: 'bad' },
      ]),
    ).toEqual([
      {
        name: 'C',
        kind: 5,
        range,
        selectionRange: range,
        children: [{ name: 'm', kind: 6, range, selectionRange: range, children: [] }],
      },
      { name: 'f', kind: 12, range, selectionRange: range, children: [] },
    ]);
  });
});
