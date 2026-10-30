import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { sheetRequestFrom } from './sheet-request-from.ts';

function fixture(): {
  sha: string;
  range: { startLine: number; startCharacter: number; endLine: number; endCharacter: number };
  token: {
    startLine: number;
    startCharacter: number;
    endLine: number;
    endCharacter: number;
    text: string;
  };
} {
  return {
    sha: 'c'.repeat(40),
    range: { startLine: 3, startCharacter: 16, endLine: 3, endCharacter: 24 },
    token: { startLine: 9, startCharacter: 2, endLine: 9, endCharacter: 6, text: 'read' },
  };
}

describe('sheetRequestFrom', () => {
  test('opens the first definition inside the repository at the answer’s commit', ({ expect }) => {
    const { sha, range, token } = fixture();
    expect(
      sheetRequestFrom('s1', {
        sha,
        token,
        targets: [
          { file: { kind: 'external', uri: 'file:///lib/lib.d.ts' }, ...range },
          { file: { kind: 'workspace', path: 'src/auth.ts' }, ...range },
        ],
      }),
    ).toStrictEqual({ sessionId: 's1', sha, path: 'src/auth.ts', range });
  });

  test('explains a definition outside the repository, or none', ({ expect }) => {
    const { sha, range, token } = fixture();
    expect(
      sheetRequestFrom('s1', {
        sha,
        token,
        targets: [{ file: { kind: 'external', uri: 'file:///lib/lib.d.ts' }, ...range }],
      }),
    ).toBe('“read” is defined outside the repository (file:///lib/lib.d.ts).');
    expect(sheetRequestFrom('s1', { sha, targets: [] })).toBe(
      'The language server knows no definition for this line.',
    );
  });
});
