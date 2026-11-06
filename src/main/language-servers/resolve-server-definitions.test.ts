import { describe } from 'vitest';

import { goServerDefinition } from '#internal/lsp/go-server-definition.ts';
import type { ServerDefinition } from '#internal/lsp/server-definition.ts';
import { test } from '#testing/test.ts';

import type { LanguageServersConfig } from './language-servers-config-schema.ts';
import { resolveServerDefinitions } from './resolve-server-definitions.ts';
import type { ResolvedServers } from './resolve-server-definitions.ts';
import type { RepositoryIdentity } from './repository-identity.ts';

function typescript(): ServerDefinition {
  return {
    id: 'typescript',
    command: '/app/node',
    args: ['/app/cli.mjs', '--stdio'],
    languageIds: { '.ts': 'typescript', '.js': 'javascript' },
    source: 'builtin',
    diagnosticsQuiet: Temporal.Duration.from({ milliseconds: 500 }),
  };
}

function repository(overrides: Partial<RepositoryIdentity> = {}): RepositoryIdentity {
  return { clonePath: '/home/me/work/api', ...overrides };
}

/** A reviewer's own server: Go's, with a module root marker and an upper-case extension. */
function goplsLayer(): LanguageServersConfig {
  return {
    servers: {
      gopls: {
        command: 'gopls',
        args: ['serve'],
        extensions: { '.GO': 'go' },
        rootMarkers: ['go.mod'],
      },
    },
  };
}

function resolve(
  layers: readonly LanguageServersConfig[],
  repo: RepositoryIdentity = repository(),
): ResolvedServers {
  return resolveServerDefinitions({
    builtins: [typescript()],
    layers,
    repository: repo,
    home: '/home/me',
  });
}

describe('resolveServerDefinitions', () => {
  test("gives beuve's own servers when there is no configuration", ({ expect }) => {
    expect(resolve([])).toStrictEqual({ definitions: [typescript()], problems: [] });
  });

  test("defines a server of the reviewer's own, after the built-in ones, marked as theirs", ({
    expect,
  }) => {
    const { definitions, problems } = resolve([goplsLayer()]);
    expect(problems).toStrictEqual([]);
    expect(definitions.map((definition) => definition.id)).toStrictEqual(['typescript', 'gopls']);
    expect(definitions[1]).toMatchObject({
      id: 'gopls',
      command: 'gopls',
      args: ['serve'],
      languageIds: { '.go': 'go' },
      rootMarkers: ['go.mod'],
      source: 'path',
      origin: 'reviewer',
    });
  });

  test("changes only the fields a built-in server's entry names, and leaves the rest", ({
    expect,
  }) => {
    const { definitions } = resolve([{ servers: { typescript: { args: ['--stdio', '--log'] } } }]);
    expect(definitions[0]).toMatchObject({
      command: '/app/node',
      args: ['--stdio', '--log'],
      languageIds: { '.ts': 'typescript', '.js': 'javascript' },
      source: 'builtin',
    });
  });

  test('keeps the built-in as it is, with its own origin, when the config only mentions it', ({
    expect,
  }) => {
    const { definitions } = resolve([{ servers: { typescript: {} } }]);
    expect(definitions[0]).toMatchObject({ source: 'builtin', origin: 'builtin' });
  });

  test('turns a server off with enabled: false', ({ expect }) => {
    const { definitions } = resolve([
      goplsLayer(),
      { servers: { typescript: { enabled: false } } },
    ]);
    expect(definitions.map((definition) => definition.id)).toStrictEqual(['gopls']);
  });

  test('lets a later file win per field over an earlier one', ({ expect }) => {
    const { definitions } = resolve([
      goplsLayer(),
      { servers: { gopls: { args: ['serve', '-rpc.trace'], env: { GOFLAGS: '-mod=mod' } } } },
    ]);
    expect(definitions[1]).toMatchObject({
      command: 'gopls',
      args: ['serve', '-rpc.trace'],
      env: { GOFLAGS: '-mod=mod' },
      rootMarkers: ['go.mod'],
    });
  });

  test('applies an override only to a repository whose clone its path matches, with ~ expanded', ({
    expect,
  }) => {
    const layer: LanguageServersConfig = {
      servers: goplsLayer().servers ?? {},
      overrides: [{ match: { path: '~/work/*' }, servers: { gopls: { args: ['-remote=auto'] } } }],
    };
    expect(
      resolve([layer], repository({ clonePath: '/home/me/work/api' })).definitions[1],
    ).toMatchObject({
      args: ['-remote=auto'],
    });
    expect(
      resolve([layer], repository({ clonePath: '/home/me/play/api' })).definitions[1],
    ).toMatchObject({
      args: ['serve'],
    });
    expect(
      resolve([layer], repository({ clonePath: '/home/me/work/api/' })).definitions[1],
    ).toMatchObject({
      args: ['-remote=auto'],
    });
  });

  test('applies a remote override to a pull request session, whatever the case of its host', ({
    expect,
  }) => {
    const layer: LanguageServersConfig = {
      overrides: [
        { match: { remote: 'GitHub.com/Octo/*' }, servers: { typescript: { enabled: false } } },
      ],
    };
    const pullRequest = repository({ remote: 'github.com/octo/handler' });
    expect(resolve([layer], pullRequest).definitions).toStrictEqual([]);
    expect(resolve([layer], repository()).definitions).toHaveLength(1);
  });

  test("applies overrides in order, later ones over earlier ones, over every file's servers", ({
    expect,
  }) => {
    const first: LanguageServersConfig = {
      servers: goplsLayer().servers ?? {},
      overrides: [{ match: { path: '/home/me/**' }, servers: { gopls: { args: ['one'] } } }],
    };
    const second: LanguageServersConfig = {
      servers: { gopls: { args: ['from-the-second-file'] } },
      overrides: [{ match: { path: '/home/me/work/**' }, servers: { gopls: { args: ['two'] } } }],
    };
    expect(resolve([first, second]).definitions[1]).toMatchObject({ args: ['two'] });
  });

  test('leaves out a server that has no command or no extensions, and says so', ({ expect }) => {
    const { definitions, problems } = resolve([
      { servers: { nocommand: { extensions: { '.x': 'x' } }, noextensions: { command: 'x' } } },
    ]);
    expect(definitions.map((definition) => definition.id)).toStrictEqual(['typescript']);
    expect(problems).toStrictEqual([
      'The nocommand language server has no command.',
      'The noextensions language server handles no file extensions.',
    ]);
  });

  test("adds to a built-in server's env and inheritEnv without dropping its own safety settings", ({
    expect,
  }) => {
    const { definitions } = resolveServerDefinitions({
      builtins: [goServerDefinition()],
      layers: [
        { servers: { gopls: { env: { GOFLAGS: '-tags=integration' }, inheritEnv: ['GOFLAGS'] } } },
        { servers: { gopls: { env: { GOPRIVATE: 'example.com/*' } } } },
      ],
      repository: repository(),
      home: '/home/me',
    });
    expect(definitions[0]?.env).toStrictEqual({
      GOTOOLCHAIN: 'local',
      GOPROXY: 'off',
      GOFLAGS: '-tags=integration',
      GOPRIVATE: 'example.com/*',
    });
    expect(definitions[0]?.inheritEnv).toStrictEqual([
      'GOPATH',
      'GOMODCACHE',
      'GOCACHE',
      'GOROOT',
      'XDG_CACHE_HOME',
      'XDG_CONFIG_HOME',
      'GOFLAGS',
    ]);
  });

  test("lets the config give one of a built-in server's variables a new value, and nothing else changes", ({
    expect,
  }) => {
    const { definitions } = resolveServerDefinitions({
      builtins: [goServerDefinition()],
      layers: [{ servers: { gopls: { env: { GOTOOLCHAIN: 'auto' } } } }],
      repository: repository(),
      home: '/home/me',
    });
    expect(definitions[0]?.env).toStrictEqual({ GOTOOLCHAIN: 'auto', GOPROXY: 'off' });
  });

  test("turns off a server's diagnostics without turning the server off", ({ expect }) => {
    const { definitions } = resolve([
      goplsLayer(),
      { servers: { gopls: { diagnostics: false }, typescript: { diagnostics: false } } },
    ]);
    expect(definitions.map((definition) => definition.diagnostics)).toStrictEqual([false, false]);
    expect(definitions.map((definition) => definition.id)).toStrictEqual(['typescript', 'gopls']);
    expect(resolve([goplsLayer()]).definitions[1]?.diagnostics).toBeUndefined();
  });

  test("lets the config ask for a program from the project, which is then the reviewer's own", ({
    expect,
  }) => {
    const { definitions } = resolve([
      {
        servers: {
          eslint: {
            command: 'node_modules/.bin/eslint-language-server',
            extensions: { '.ts': 'typescript' },
            source: 'project',
          },
        },
      },
    ]);
    expect(definitions[1]).toMatchObject({ id: 'eslint', source: 'project', origin: 'reviewer' });
  });
});
