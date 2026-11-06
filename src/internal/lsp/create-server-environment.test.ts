import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { createServerEnvironment } from './create-server-environment.ts';

describe('createServerEnvironment', () => {
  test('keeps only the allow-listed variables and adds extras', ({ expect }) => {
    const environment = createServerEnvironment(
      {
        PATH: '/usr/bin',
        HOME: '/home/me',
        LC_ALL: 'C.UTF-8',
        NODE_OPTIONS: '--require /tmp/evil.js',
        GITHUB_TOKEN: 'secret',
        ELECTRON_RUN_AS_NODE: '1',
        TMPDIR: undefined,
      },
      { TSS_LOG: '' },
    );
    expect(environment).toStrictEqual({
      PATH: '/usr/bin',
      HOME: '/home/me',
      LC_ALL: 'C.UTF-8',
      TSS_LOG: '',
    });
  });

  test('passes on the further variables a definition names, and no others', ({ expect }) => {
    const environment = createServerEnvironment(
      { PATH: '/usr/bin', GOPATH: '/home/me/go', GOFLAGS: '-mod=mod', GITHUB_TOKEN: 'secret' },
      {},
      ['GOPATH', 'MISSING'],
    );
    expect(environment).toStrictEqual({ PATH: '/usr/bin', GOPATH: '/home/me/go' });
  });
});
