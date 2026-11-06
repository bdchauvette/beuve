import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { createServerEnvironment } from './create-server-environment.ts';
import { goServerDefinition } from './go-server-definition.ts';

describe('goServerDefinition', () => {
  test('is gopls, found on PATH, serving .go files with a server per go.mod', ({ expect }) => {
    expect(goServerDefinition()).toMatchObject({
      id: 'gopls',
      command: 'gopls',
      languageIds: { '.go': 'go' },
      rootMarkers: ['go.mod'],
      source: 'path',
    });
    expect(goServerDefinition({ command: '/opt/gopls' }).command).toBe('/opt/gopls');
  });

  test('waits long enough for the analyzers that come after the type check', ({ expect }) => {
    const { diagnosticsQuiet } = goServerDefinition();
    expect(Temporal.Duration.compare(diagnosticsQuiet, { seconds: 3 })).toBeGreaterThanOrEqual(0);
  });

  test('keeps the reviewed repository from fetching a toolchain or a module, and passes on the reviewer’s Go locations but not their GOFLAGS', ({
    expect,
  }) => {
    const definition = goServerDefinition();
    const environment = createServerEnvironment(
      {
        PATH: '/usr/local/go/bin:/usr/bin',
        HOME: '/home/me',
        GOPATH: '/home/me/go',
        GOCACHE: '/home/me/.cache/go-build',
        GOFLAGS: '-mod=mod',
        GOPROXY: 'https://proxy.example.com',
        GOTOOLCHAIN: 'auto',
        GITHUB_TOKEN: 'secret',
      },
      definition.env,
      definition.inheritEnv,
    );
    expect(environment).toStrictEqual({
      PATH: '/usr/local/go/bin:/usr/bin',
      HOME: '/home/me',
      GOPATH: '/home/me/go',
      GOCACHE: '/home/me/.cache/go-build',
      GOTOOLCHAIN: 'local',
      GOPROXY: 'off',
    });
  });
});
