import { describe, expect, it } from 'vitest';

import { parseGithubRemoteUrl } from './parse-github-remote-url.ts';

describe('parseGithubRemoteUrl', () => {
  it.each([
    ['https://github.com/octo-org/hello-world.git', 'github.com'],
    ['https://github.com/octo-org/hello-world', 'github.com'],
    ['https://GitHub.com/octo-org/hello-world/', 'github.com'],
    ['git@github.com:octo-org/hello-world.git', 'github.com'],
    ['github.com:octo-org/hello-world', 'github.com'],
    ['ssh://git@github.com/octo-org/hello-world.git', 'github.com'],
    ['ssh://git@ssh.github.com:443/octo-org/hello-world.git', 'github.com'],
    ['https://ghe.example.com/octo-org/hello-world.git', 'ghe.example.com'],
    ['git@ghe.example.com:octo-org/hello-world.git', 'ghe.example.com'],
  ])('reads %s', (url, host) => {
    expect(parseGithubRemoteUrl(url)).toEqual({ host, owner: 'octo-org', repo: 'hello-world' });
  });

  it.each([
    '/srv/git/hello-world.git',
    './relative.git',
    'file:///srv/git/o/r.git',
    'https://github.com/octo-org',
    'https://github.com/octo-org/hello-world/tree/main',
    'https://github.com/-bad/repo',
    'C:\\repos\\x',
    '',
  ])('ignores %s', (url) => {
    expect(parseGithubRemoteUrl(url)).toBeUndefined();
  });
});
