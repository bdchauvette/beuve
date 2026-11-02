import { describe } from 'vitest';

import type { GithubAuthStatusView } from '#contract/ipc-contract.ts';

import { signInHintOf } from './sign-in-hint-of.ts';
import { test } from './testing/test.ts';

function signedOut(remedy?: string): GithubAuthStatusView {
  return {
    kind: 'signed-out',
    host: 'github.com',
    message: 'not signed in',
    ...(remedy !== undefined && { remedy }),
  } as unknown as GithubAuthStatusView;
}

describe('signInHintOf', () => {
  test('waits for the check before it knows', ({ expect }) => {
    expect(signInHintOf(undefined)).toBe('checking GitHub sign-in…');
  });

  test('says how to sign in when it knows', ({ expect }) => {
    expect(signInHintOf(signedOut('gh auth login'))).toBe('sign in first: run gh auth login.');
  });

  test('falls back to the message without a remedy', ({ expect }) => {
    expect(signInHintOf(signedOut())).toBe('not signed in');
  });
});
