import { describe, expect, it } from 'vitest';

import { findMatchingRemote } from './find-matching-remote.ts';

describe('findMatchingRemote', () => {
  const repository = { host: 'github.com', owner: 'Octo-Org', repo: 'hello-world' };

  it('finds the remote for the repository whatever the URL form and case', () => {
    expect(
      findMatchingRemote(
        [
          { name: 'fork', url: 'git@github.com:me/hello-world.git' },
          { name: 'upstream', url: 'ssh://git@github.com/octo-org/Hello-World.git' },
        ],
        repository,
      ),
    ).toEqual({ name: 'upstream', url: 'ssh://git@github.com/octo-org/Hello-World.git' });
  });

  it('ignores other hosts and local paths', () => {
    expect(
      findMatchingRemote(
        [
          { name: 'ghe', url: 'https://ghe.example.com/octo-org/hello-world.git' },
          { name: 'local', url: '/srv/octo-org/hello-world.git' },
        ],
        repository,
      ),
    ).toBeUndefined();
  });
});
