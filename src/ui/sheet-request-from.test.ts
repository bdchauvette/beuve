import { describe } from 'vitest';

import { test } from './testing/test.ts';

import type { DefinitionView, SheetRangeView } from '#contract/ipc-contract.ts';

import { sheetRequestFrom } from './sheet-request-from.ts';

/** A definition answer's commit, the range of each target, and the token asked about. */
interface Fixture {
  readonly sha: string;
  readonly range: SheetRangeView;
  readonly token: NonNullable<DefinitionView['token']>;
}

function fixture(): Fixture {
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
