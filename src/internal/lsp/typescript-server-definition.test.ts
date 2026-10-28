import { describe, expect, it } from 'vitest';

import { typescriptServerDefinition } from './typescript-server-definition.ts';

describe('typescriptServerDefinition', () => {
  it('runs over stdio with type acquisition and logging off', () => {
    const definition = typescriptServerDefinition();
    expect(definition).toMatchObject({
      id: 'typescript',
      command: 'typescript-language-server',
      args: ['--stdio'],
    });
    expect(definition.languageIds['.tsx']).toBe('typescriptreact');
    expect(definition.initializationOptions).toEqual({
      disableAutomaticTypingAcquisition: true,
      hostInfo: 'beuve',
      tsserver: { logVerbosity: 'off', trace: 'off' },
    });
  });

  it('pins tsserver and accepts a Node launcher', () => {
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
