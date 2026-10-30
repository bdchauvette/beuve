import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import type { LspCallHierarchyItem, LspRange } from './lsp-protocol.ts';
import { parseCallHierarchyItems } from './parse-call-hierarchy-items.ts';

function range(): LspRange {
  return { start: { line: 1, character: 2 }, end: { line: 3, character: 4 } };
}

function item(): LspCallHierarchyItem {
  return {
    name: 'f',
    kind: 12,
    uri: 'file:///a.ts',
    range: range(),
    selectionRange: range(),
    data: { opaque: 1 },
  };
}

describe('parseCallHierarchyItems', () => {
  test('keeps items verbatim, including server data', ({ expect }) => {
    expect(parseCallHierarchyItems([item(), { name: 'bad' }], 'items')).toStrictEqual([
      { item: item(), fromRanges: [] },
    ]);
    expect(parseCallHierarchyItems(undefined, 'items')).toStrictEqual([]);
  });

  test('reads incoming and outgoing edges with their call ranges', ({ expect }) => {
    expect(
      parseCallHierarchyItems([{ from: item(), fromRanges: [range(), { bogus: true }] }], 'from'),
    ).toStrictEqual([{ item: item(), fromRanges: [range()] }]);
    expect(parseCallHierarchyItems([{ to: item() }, { from: item() }], 'to')).toStrictEqual([
      { item: item(), fromRanges: [] },
    ]);
  });
});
