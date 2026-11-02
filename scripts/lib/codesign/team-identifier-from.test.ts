import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { teamIdentifierFrom } from './team-identifier-from.ts';

describe('teamIdentifierFrom', () => {
  test('reads the identifier from codesign details', ({ expect }) => {
    const details = [
      'Executable=/x/node',
      'Authority=Developer ID Application: Node.js Foundation (HX7739G8FX)',
      'TeamIdentifier=HX7739G8FX',
      'Sealed Resources=none',
    ].join('\n');

    expect(teamIdentifierFrom(details)).toStrictEqual({ ok: true, value: 'HX7739G8FX' });
  });

  test('rejects an ad-hoc signature', ({ expect }) => {
    const result = teamIdentifierFrom('Signature=adhoc\nTeamIdentifier=not set\n');

    expect(result.ok).toBe(false);
  });

  test('rejects output with no TeamIdentifier line', ({ expect }) => {
    const result = teamIdentifierFrom('Executable=/x/node\n');

    expect(result.ok).toBe(false);
  });
});
