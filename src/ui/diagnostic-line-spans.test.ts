import { describe } from 'vitest';

import type { DiagnosticItemView } from '#contract/ipc-contract.ts';

import { diagnosticLineSpans } from './diagnostic-line-spans.ts';
import { test } from './testing/test.ts';

/** `[startLine, startCharacter, endLine, endCharacter]`. */
type RangeOf = readonly [number, number, number, number];

function item(range: RangeOf): DiagnosticItemView {
  const [startLine, startCharacter, endLine, endCharacter] = range;
  return {
    startLine,
    startCharacter,
    endLine,
    endCharacter,
    severity: 'error',
    message: 'm',
    serverId: 'typescript',
  };
}

/** Lines 1, 2, 3 and 5 are on screen; line 4 is collapsed. */
function lengthOf(line: number): number | undefined {
  return new Map([
    [1, 20],
    [2, 10],
    [3, 15],
    [5, 8],
  ]).get(line);
}

describe('diagnosticLineSpans', () => {
  test('covers the columns of a range on one line', ({ expect }) => {
    expect(diagnosticLineSpans(item([1, 13, 1, 19]), lengthOf)).toStrictEqual([
      { line: 1, start: 13, end: 19 },
    ]);
  });

  test('covers the rest of the first line, the middle ones and the start of the last', ({
    expect,
  }) => {
    expect(diagnosticLineSpans(item([1, 15, 3, 4]), lengthOf)).toStrictEqual([
      { line: 1, start: 15, end: 20 },
      { line: 2, start: 0, end: 10 },
      { line: 3, start: 0, end: 4 },
    ]);
  });

  test('skips lines the diff does not show', ({ expect }) => {
    expect(diagnosticLineSpans(item([3, 2, 5, 3]), lengthOf)).toStrictEqual([
      { line: 3, start: 2, end: 15 },
      { line: 5, start: 0, end: 3 },
    ]);
    expect(diagnosticLineSpans(item([4, 0, 4, 3]), lengthOf)).toStrictEqual([]);
  });

  test('widens an empty range to the character it sits on, or the one before at a line end', ({
    expect,
  }) => {
    expect(diagnosticLineSpans(item([2, 4, 2, 4]), lengthOf)).toStrictEqual([
      { line: 2, start: 4, end: 5 },
    ]);
    expect(diagnosticLineSpans(item([2, 10, 2, 10]), lengthOf)).toStrictEqual([
      { line: 2, start: 9, end: 10 },
    ]);
  });

  test('cuts a range that runs past the end of its line, and ignores an empty line', ({
    expect,
  }) => {
    expect(diagnosticLineSpans(item([5, 2, 5, 99]), lengthOf)).toStrictEqual([
      { line: 5, start: 2, end: 8 },
    ]);
    expect(diagnosticLineSpans(item([7, 0, 7, 0]), () => 0)).toStrictEqual([]);
  });
});
