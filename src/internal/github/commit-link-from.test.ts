import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { commitLinkFrom } from './commit-link-from.ts';

describe('commitLinkFrom', () => {
  test('links the commit on the remote’s own host', ({ expect }) => {
    const sha = 'a'.repeat(40);
    expect(commitLinkFrom({ host: 'github.com', owner: 'octo', repo: 'beuve', sha })).toBe(
      `https://github.com/octo/beuve/commit/${sha}`,
    );
    expect(commitLinkFrom({ host: 'GHE.Example.com', owner: 'octo', repo: 'beuve', sha })).toBe(
      `https://ghe.example.com/octo/beuve/commit/${sha}`,
    );
  });

  test('encodes the owner and the repository on their own', ({ expect }) => {
    const sha = 'b'.repeat(40);
    expect(commitLinkFrom({ host: 'github.com', owner: 'a b', repo: 'c#d', sha })).toBe(
      `https://github.com/a%20b/c%23d/commit/${sha}`,
    );
  });
});
