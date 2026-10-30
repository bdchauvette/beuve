import { inspect } from 'node:util';

import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { GithubToken } from './github-token.ts';

describe('GithubToken', () => {
  test('trims and keeps the secret behind reveal()', ({ expect }) => {
    const token = GithubToken.parse('  ghp_secretsecret\n');
    expect(token?.reveal()).toBe('ghp_secretsecret');
    expect(`${String(token)} ${JSON.stringify([token])} ${inspect(token)}`).toBe(
      '[redacted] ["[redacted]"] [redacted]',
    );
  });

  test('rejects empty or multi-word output', ({ expect }) => {
    expect(GithubToken.parse('\n')).toBeUndefined();
    expect(GithubToken.parse('two words')).toBeUndefined();
  });
});
