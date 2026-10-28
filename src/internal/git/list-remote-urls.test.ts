import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { listRemoteUrls } from './list-remote-urls.ts';
import { openRepository } from './open-repository.ts';
import type { GitRepository } from './open-repository.ts';
import { createTestRepository } from './testing/create-test-repository.ts';
import type { TestRepository } from './testing/create-test-repository.ts';

describe('listRemoteUrls', () => {
  let repo: TestRepository;
  let git: GitRepository;

  beforeEach(async () => {
    repo = createTestRepository();
    const opened = await openRepository(repo.directory);
    if (!opened.ok) {
      throw new Error(opened.error.kind);
    }
    git = opened.value;
  });

  afterEach(() => {
    repo.cleanup();
  });

  it('is empty without remotes', async () => {
    expect(await listRemoteUrls(git)).toEqual({ ok: true, value: [] });
  });

  it('lists configured URLs, before insteadOf rewrites, including dotted names', async () => {
    repo.git('remote', 'add', 'origin', 'git@github.com:octo-org/hello-world.git');
    repo.git('remote', 'add', 'fork.me', 'https://ghe.example.com/me/hello-world');
    repo.git('config', 'url./elsewhere.insteadOf', 'git@github.com:');
    expect(await listRemoteUrls(git)).toEqual({
      ok: true,
      value: [
        { name: 'origin', url: 'git@github.com:octo-org/hello-world.git' },
        { name: 'fork.me', url: 'https://ghe.example.com/me/hello-world' },
      ],
    });
  });
});
