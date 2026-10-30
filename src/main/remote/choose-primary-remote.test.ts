import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { choosePrimaryRemote } from './choose-primary-remote.ts';

describe('choosePrimaryRemote', () => {
  test('takes the pull request base repository, else origin, else the first GitHub remote', ({
    expect,
  }) => {
    expect(
      choosePrimaryRemote(remotes(), { host: 'github.com', owner: 'octo', repo: 'beuve' })?.name,
    ).toBe('upstream');
    expect(choosePrimaryRemote(remotes())).toStrictEqual({
      name: 'origin',
      repository: { host: 'ghe.example.com', owner: 'team', repo: 'beuve' },
    });
    expect(choosePrimaryRemote(remotes().filter((remote) => remote.name !== 'origin'))?.name).toBe(
      'fork',
    );
    expect(
      choosePrimaryRemote(remotes(), { host: 'github.com', owner: 'other', repo: 'x' })?.name,
    ).toBe('origin');
    expect(
      choosePrimaryRemote([remotes()[0]].filter((remote) => remote !== undefined)),
    ).toBeUndefined();
  });
});

function remotes(): { name: string; url: string }[] {
  return [
    { name: 'backup', url: '/srv/git/beuve.git' },
    { name: 'fork', url: 'git@github.com:me/beuve.git' },
    { name: 'origin', url: 'https://ghe.example.com/team/beuve' },
    { name: 'upstream', url: 'https://github.com/Octo/Beuve.git' },
  ];
}
