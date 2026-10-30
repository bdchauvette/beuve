import { describe } from 'vitest';

import { listRemoteUrls } from './list-remote-urls.ts';
import { test } from './testing/test.ts';

describe('listRemoteUrls', () => {
  test('is empty without remotes', async ({ expect, repository: git }) => {
    await expect(listRemoteUrls(git)).resolves.toStrictEqual({ ok: true, value: [] });
  });

  test('lists configured URLs, before insteadOf rewrites, including dotted names', async ({
    expect,
    repo,
    repository: git,
  }) => {
    await repo.git('remote', 'add', 'origin', 'git@github.com:octo-org/hello-world.git');
    await repo.git('remote', 'add', 'fork.me', 'https://ghe.example.com/me/hello-world');
    await repo.git('config', 'url./elsewhere.insteadOf', 'git@github.com:');
    await expect(listRemoteUrls(git)).resolves.toStrictEqual({
      ok: true,
      value: [
        { name: 'origin', url: 'git@github.com:octo-org/hello-world.git' },
        { name: 'fork.me', url: 'https://ghe.example.com/me/hello-world' },
      ],
    });
  });
});
