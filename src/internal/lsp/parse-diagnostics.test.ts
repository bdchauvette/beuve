import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import type { LspRange } from './lsp-protocol.ts';
import { parseDiagnostics } from './parse-diagnostics.ts';

function range(): LspRange {
  return { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
}

describe('parseDiagnostics', () => {
  test('drops malformed entries and unknown optional values', ({ expect }) => {
    expect(
      parseDiagnostics([
        {
          range: range(),
          message: 'ok',
          severity: 9,
          code: { x: 1 },
          tags: [1, 'x'],
          relatedInformation: [{ message: 'no location' }],
        },
        { range: range() },
        'junk',
      ]),
    ).toStrictEqual([{ range: range(), message: 'ok', tags: [1], relatedInformation: [] }]);
    expect(parseDiagnostics({})).toStrictEqual([]);
  });
});
