import { describe, expect, it } from 'vitest';

import { parseLocations } from './parse-locations.ts';

const range = { start: { line: 0, character: 1 }, end: { line: 0, character: 2 } };

describe('parseLocations', () => {
  it('accepts a location, location arrays, location links and null', () => {
    expect(parseLocations({ uri: 'file:///a', range })).toEqual([{ uri: 'file:///a', range }]);
    expect(
      parseLocations([
        { uri: 'file:///a', range },
        { targetUri: 'file:///b', targetRange: range, targetSelectionRange: range },
        {
          uri: 'file:///c',
          range: { start: { line: -1, character: 0 }, end: { line: 0, character: 0 } },
        },
      ]),
    ).toEqual([
      { uri: 'file:///a', range },
      { uri: 'file:///b', range },
    ]);
    expect(parseLocations(JSON.parse('null'))).toEqual([]);
  });
});
