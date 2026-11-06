import { describe } from 'vitest';

import type { DiagnosticItemView } from '#contract/ipc-contract.ts';
import { test } from './testing/test.ts';

import { diagnosticsAt } from './diagnostics-at.ts';

function item(
  range: [startLine: number, startCharacter: number, endLine: number, endCharacter: number],
  message: string,
): DiagnosticItemView {
  const [startLine, startCharacter, endLine, endCharacter] = range;
  return {
    startLine,
    startCharacter,
    endLine,
    endCharacter,
    severity: 'error',
    message,
    serverId: 'typescript',
  };
}

describe('diagnosticsAt', () => {
  test('covers the characters of a range, and not the one after its end', ({ expect }) => {
    const items = [item([3, 4, 3, 8], 'a')];
    expect(diagnosticsAt(items, { line: 3, character: 4 })).toHaveLength(1);
    expect(diagnosticsAt(items, { line: 3, character: 7 })).toHaveLength(1);
    expect(diagnosticsAt(items, { line: 3, character: 8 })).toHaveLength(0);
    expect(diagnosticsAt(items, { line: 3, character: 3 })).toHaveLength(0);
    expect(diagnosticsAt(items, { line: 2, character: 5 })).toHaveLength(0);
  });

  test('follows a range across lines', ({ expect }) => {
    const items = [item([2, 10, 4, 3], 'a')];
    expect(diagnosticsAt(items, { line: 2, character: 9 })).toHaveLength(0);
    expect(diagnosticsAt(items, { line: 2, character: 10 })).toHaveLength(1);
    expect(diagnosticsAt(items, { line: 3, character: 99 })).toHaveLength(1);
    expect(diagnosticsAt(items, { line: 4, character: 2 })).toHaveLength(1);
    expect(diagnosticsAt(items, { line: 4, character: 3 })).toHaveLength(0);
  });

  test('covers only the character an empty range sits on', ({ expect }) => {
    const items = [item([5, 6, 5, 6], 'a')];
    expect(diagnosticsAt(items, { line: 5, character: 6 })).toHaveLength(1);
    expect(diagnosticsAt(items, { line: 5, character: 7 })).toHaveLength(0);
    expect(diagnosticsAt(items, { line: 5, character: 5 })).toHaveLength(0);
  });

  test('returns every diagnostic that covers the place, in the given order', ({ expect }) => {
    const items = [
      item([1, 0, 1, 10], 'wide'),
      item([1, 4, 1, 6], 'narrow'),
      item([9, 0, 9, 1], 'x'),
    ];
    expect(
      diagnosticsAt(items, { line: 1, character: 5 }).map((found) => found.message),
    ).toStrictEqual(['wide', 'narrow']);
  });
});
