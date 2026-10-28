import { describe, expect, it } from 'vitest';

import { parseCallHierarchyItems } from './parse-call-hierarchy-items.ts';

const range = { start: { line: 1, character: 2 }, end: { line: 3, character: 4 } };
const item = {
  name: 'f',
  kind: 12,
  uri: 'file:///a.ts',
  range,
  selectionRange: range,
  data: { opaque: 1 },
};

describe('parseCallHierarchyItems', () => {
  it('keeps items verbatim, including server data', () => {
    expect(parseCallHierarchyItems([item, { name: 'bad' }], 'items')).toEqual([
      { item, fromRanges: [] },
    ]);
    expect(parseCallHierarchyItems(undefined, 'items')).toEqual([]);
  });

  it('reads incoming and outgoing edges with their call ranges', () => {
    expect(
      parseCallHierarchyItems([{ from: item, fromRanges: [range, { bogus: true }] }], 'from'),
    ).toEqual([{ item, fromRanges: [range] }]);
    expect(parseCallHierarchyItems([{ to: item }, { from: item }], 'to')).toEqual([
      { item, fromRanges: [] },
    ]);
  });
});
