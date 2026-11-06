import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { languageServersConfigPaths } from './language-servers-config-paths.ts';

describe('languageServersConfigPaths', () => {
  test('reads the XDG location first, then userData, which wins', ({ expect }) => {
    expect(
      languageServersConfigPaths({
        xdgConfigHome: undefined,
        home: '/Users/me',
        userData: '/Users/me/Library/Application Support/beuve',
      }),
    ).toStrictEqual([
      '/Users/me/.config/beuve/language-servers.json',
      '/Users/me/Library/Application Support/beuve/language-servers.json',
    ]);
  });

  test('follows XDG_CONFIG_HOME when it is set and absolute', ({ expect }) => {
    const paths = languageServersConfigPaths({
      xdgConfigHome: '/etc/xdg-me',
      home: '/home/me',
      userData: '/home/me/.config/beuve-data',
    });
    expect(paths[0]).toBe('/etc/xdg-me/beuve/language-servers.json');
    const relative = languageServersConfigPaths({
      xdgConfigHome: 'relative/config',
      home: '/home/me',
      userData: '/data',
    });
    expect(relative[0]).toBe('/home/me/.config/beuve/language-servers.json');
  });

  test('lists one file once when both places are the same', ({ expect }) => {
    expect(
      languageServersConfigPaths({
        xdgConfigHome: undefined,
        home: '/home/me',
        userData: '/home/me/.config/beuve',
      }),
    ).toStrictEqual(['/home/me/.config/beuve/language-servers.json']);
  });
});
