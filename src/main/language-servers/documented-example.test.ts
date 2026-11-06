import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe } from 'vitest';

import { goServerDefinition } from '#internal/lsp/go-server-definition.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';
import { test } from '#testing/test.ts';

import { parseLanguageServersConfig } from './parse-language-servers-config.ts';
import type { RepositoryIdentity } from './repository-identity.ts';
import { resolveServerDefinitions } from './resolve-server-definitions.ts';

/** The example the documentation points to (docs/language-servers.md). */
async function readExample(signal: AbortSignal): Promise<string> {
  const file = path.resolve(import.meta.dirname, '../../../docs/examples/language-servers.json');
  return readFile(file, { encoding: 'utf8', signal });
}

describe('docs/examples/language-servers.json', () => {
  test('is a valid configuration that gives Python through Pyright and Ruff', async ({
    expect,
    signal,
  }) => {
    const config = okValueFrom(parseLanguageServersConfig(await readExample(signal)));
    const { definitions, problems } = resolveServerDefinitions({
      builtins: [goServerDefinition()],
      layers: [config],
      repository: { clonePath: '/home/me/play/app' },
      home: '/home/me',
    });
    expect(problems).toStrictEqual([]);
    expect(definitions.map((definition) => definition.id)).toStrictEqual([
      'gopls',
      'pyright',
      'ruff',
    ]);
    expect(definitions[1]).toMatchObject({
      command: 'pyright-langserver',
      languageIds: { '.py': 'python', '.pyi': 'python' },
      rootMarkers: ['pyproject.toml', 'setup.py', 'setup.cfg'],
      origin: 'reviewer',
    });
  });

  test('switches Ruff off for the named remote', async ({ expect, signal }) => {
    const config = okValueFrom(parseLanguageServersConfig(await readExample(signal)));
    const idsFor = (repository: RepositoryIdentity): string[] => {
      return resolveServerDefinitions({
        builtins: [goServerDefinition()],
        layers: [config],
        repository,
        home: '/home/me',
      }).definitions.map((definition) => definition.id);
    };
    const clonePath = '/home/me/play/app';
    expect(idsFor({ clonePath, remote: 'github.com/octo/handler' })).toStrictEqual([
      'gopls',
      'pyright',
    ]);
    expect(idsFor({ clonePath })).toStrictEqual(['gopls', 'pyright', 'ruff']);
  });

  test('adds a Go variable for clones under ~/work, keeping the safety settings', async ({
    expect,
    signal,
  }) => {
    const config = okValueFrom(parseLanguageServersConfig(await readExample(signal)));
    const envAt = (clonePath: string): Readonly<Record<string, string>> | undefined => {
      return resolveServerDefinitions({
        builtins: [goServerDefinition()],
        layers: [config],
        repository: { clonePath },
        home: '/home/me',
      }).definitions[0]?.env;
    };
    expect(envAt('/home/me/work/app')).toStrictEqual({
      GOTOOLCHAIN: 'local',
      GOPROXY: 'off',
      GOFLAGS: '-tags=integration',
    });
    expect(envAt('/home/me/play/app')).toStrictEqual({ GOTOOLCHAIN: 'local', GOPROXY: 'off' });
  });
});
