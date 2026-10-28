import { describe, expect, it } from 'vitest';

import { createTraceEnvironment } from './create-trace-environment.ts';

describe('createTraceEnvironment', () => {
  it('passes an allow-list, extras, and forces CI without colours', () => {
    expect(
      createTraceEnvironment(
        {
          PATH: '/bin',
          HOME: '/home/me',
          TZ: 'UTC',
          LC_ALL: 'C',
          NODE_OPTIONS: '--require evil.js',
          GITHUB_TOKEN: 'secret',
          ELECTRON_RUN_AS_NODE: '1',
          CI: undefined,
        },
        { ELECTRON_RUN_AS_NODE: '1' },
      ),
    ).toEqual({
      PATH: '/bin',
      HOME: '/home/me',
      TZ: 'UTC',
      LC_ALL: 'C',
      ELECTRON_RUN_AS_NODE: '1',
      CI: '1',
      NO_COLOR: '1',
      FORCE_COLOR: '0',
    });
  });
});
