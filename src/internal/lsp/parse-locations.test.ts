import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { parseLocations } from './parse-locations.ts';

function rangeOf(line: number): {
  start: { line: number; character: number };
  end: { line: number; character: number };
} {
  return { start: { line, character: 1 }, end: { line, character: 2 } };
}

describe('parseLocations', () => {
  test('accepts a location, location arrays, location links and null', ({ expect }) => {
    expect(parseLocations({ uri: 'file:///a', range: rangeOf(0) })).toStrictEqual([
      { uri: 'file:///a', range: rangeOf(0) },
    ]);
    expect(
      parseLocations([
        { uri: 'file:///a', range: rangeOf(0) },
        { targetUri: 'file:///b', targetRange: rangeOf(0), targetSelectionRange: rangeOf(3) },
        {
          uri: 'file:///c',
          range: { start: { line: -1, character: 0 }, end: { line: 0, character: 0 } },
        },
        'nonsense',
      ]),
    ).toStrictEqual([
      { uri: 'file:///a', range: rangeOf(0) },
      { uri: 'file:///b', range: rangeOf(3) },
    ]);
    expect(parseLocations(JSON.parse('null'))).toStrictEqual([]);
  });
});
