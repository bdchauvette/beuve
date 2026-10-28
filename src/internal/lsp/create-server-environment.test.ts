import { describe, expect, it } from 'vitest';

import { createServerEnvironment } from './create-server-environment.ts';

describe('createServerEnvironment', () => {
  it('keeps only the allow-listed variables and adds extras', () => {
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
    expect(environment).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/me',
      LC_ALL: 'C.UTF-8',
      TSS_LOG: '',
    });
  });
});
