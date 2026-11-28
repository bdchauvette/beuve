import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { renameNamingFrom } from './rename-naming-from.ts';

describe('renameNamingFrom', () => {
  const headSha = 'a'.repeat(40);

  test.for([
    [
      'a token to rename',
      {
        ok: true,
        value: {
          kind: 'ready',
          headSha,
          range: { startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 3 },
          placeholder: 'old',
        },
      },
      { kind: 'ready', placeholder: 'old' },
    ],
    [
      'the server’s refusal',
      { ok: true, value: { kind: 'refused', headSha, message: 'You cannot rename this element.' } },
      { kind: 'refused', message: 'You cannot rename this element.' },
    ],
    [
      'a failure',
      { ok: false, error: { code: 'stale-review', message: 'reload it first' } },
      { kind: 'refused', message: 'reload it first' },
    ],
    [
      'a superseded request',
      { ok: false, error: { code: 'cancelled', message: 'cancelled' } },
      { kind: 'cancelled' },
    ],
  ] as const)('shows %s', ([, answer, expected], { expect }) => {
    expect(renameNamingFrom(answer)).toStrictEqual(expected);
  });
});
