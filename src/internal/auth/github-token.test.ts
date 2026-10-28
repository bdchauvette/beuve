import { inspect } from 'node:util';

import { describe, expect, it } from 'vitest';

import { GithubToken } from './github-token.ts';

describe('GithubToken', () => {
  it('trims and keeps the secret behind reveal()', () => {
    const token = GithubToken.parse('  ghp_secretsecret\n');
    expect(token?.reveal()).toBe('ghp_secretsecret');
    expect(`${String(token)} ${JSON.stringify([token])} ${inspect(token)}`).toBe(
      '[redacted] ["[redacted]"] [redacted]',
    );
  });

  it('rejects empty or multi-word output', () => {
    expect(GithubToken.parse('\n')).toBeUndefined();
    expect(GithubToken.parse('two words')).toBeUndefined();
  });
});
