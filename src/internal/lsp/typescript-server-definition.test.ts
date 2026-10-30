import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { typescriptServerDefinition } from './typescript-server-definition.ts';

describe('typescriptServerDefinition', () => {
  test('runs over stdio with type acquisition and logging off', ({ expect }) => {
    const definition = typescriptServerDefinition();
    expect(definition).toMatchObject({
      id: 'typescript',
      command: 'typescript-language-server',
      args: ['--stdio'],
    });
    expect(definition.languageIds['.tsx']).toBe('typescriptreact');
    expect(definition.initializationOptions).toStrictEqual({
      disableAutomaticTypingAcquisition: true,
      hostInfo: 'beuve',
      tsserver: { logVerbosity: 'off', trace: 'off' },
    });
  });

  test('pins tsserver and accepts a Node launcher', ({ expect }) => {
    const definition = typescriptServerDefinition({
      command: '/app/electron',
      leadingArgs: ['/app/cli.mjs'],
      tsserverPath: '/app/typescript/lib/tsserver.js',
      env: { ELECTRON_RUN_AS_NODE: '1' },
    });
    expect(definition).toMatchObject({
      command: '/app/electron',
      args: ['/app/cli.mjs', '--stdio'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
      initializationOptions: { tsserver: { path: '/app/typescript/lib/tsserver.js' } },
    });
  });
});
