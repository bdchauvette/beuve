import { describe, expect, it } from 'vitest';

import { parseDiagnostics } from './parse-diagnostics.ts';

const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };

describe('parseDiagnostics', () => {
  it('drops malformed entries and unknown optional values', () => {
    expect(
      parseDiagnostics([
        {
          range,
          message: 'ok',
          severity: 9,
          code: { x: 1 },
          tags: [1, 'x'],
          relatedInformation: [{ message: 'no location' }],
        },
        { range },
        'junk',
      ]),
    ).toEqual([{ range, message: 'ok', tags: [1], relatedInformation: [] }]);
    expect(parseDiagnostics({})).toEqual([]);
  });
});
