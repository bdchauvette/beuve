import { describe } from 'vitest';

import type { ServerDefinition } from '#internal/lsp/server-definition.ts';
import { test } from '#testing/test.ts';

import { applyLanguageSettings } from './apply-language-settings.ts';
import type { LanguageSettings } from './language-servers-config-schema.ts';

function server(id: string, languageIds: Record<string, string>): ServerDefinition {
  return {
    id,
    command: id,
    args: [],
    languageIds,
    source: 'path',
    diagnosticsQuiet: Temporal.Duration.from({ milliseconds: 500 }),
  };
}

function servers(): ServerDefinition[] {
  return [
    server('pyright', { '.py': 'python' }),
    server('ruff', { '.py': 'python' }),
    server('typescript', { '.ts': 'typescript', '.js': 'javascript' }),
  ];
}

function apply(
  languages: Record<string, LanguageSettings>,
): ReturnType<typeof applyLanguageSettings> {
  return applyLanguageSettings({
    definitions: servers(),
    languages: new Map(Object.entries(languages)),
  });
}

function ids(result: ReturnType<typeof applyLanguageSettings>): string[] {
  return result.definitions.map((definition) => definition.id);
}

describe('applyLanguageSettings', () => {
  test('changes nothing without settings', ({ expect }) => {
    expect(apply({}).definitions).toStrictEqual(servers());
  });

  test('turns a language off for every server, dropping a server left with none', ({ expect }) => {
    const result = apply({ python: { enabled: false } });
    expect(ids(result)).toStrictEqual(['typescript']);
  });

  test('keeps a server that still serves another language', ({ expect }) => {
    const result = apply({ javascript: { enabled: false } });
    expect(ids(result)).toStrictEqual(['pyright', 'ruff', 'typescript']);
    expect(result.definitions[2]?.languageIds).toStrictEqual({ '.ts': 'typescript' });
  });

  test('keeps only the servers a list names, in its order', ({ expect }) => {
    const result = apply({ python: { servers: ['ruff'] } });
    expect(ids(result)).toStrictEqual(['ruff', 'typescript']);
    expect(result.problems).toStrictEqual([]);
  });

  test('puts the servers a list names before "..." and the rest after', ({ expect }) => {
    const result = apply({ python: { servers: ['ruff', '...'] } });
    expect(ids(result)).toStrictEqual(['ruff', 'pyright', 'typescript']);
  });

  test('leaves a server out with "!" and keeps the rest', ({ expect }) => {
    expect(ids(apply({ python: { servers: ['!pyright', '...'] } }))).toStrictEqual([
      'ruff',
      'typescript',
    ]);
    expect(ids(apply({ python: { servers: ['!pyright'] } }))).toStrictEqual(['ruff', 'typescript']);
  });

  test('reports a name that does not serve the language, and carries on', ({ expect }) => {
    const result = apply({ python: { servers: ['gopls', '!typescript', '...'] } });
    expect(result.problems).toHaveLength(2);
    expect(ids(result)).toStrictEqual(['pyright', 'ruff', 'typescript']);
  });

  test('ignores a language nothing serves', ({ expect }) => {
    const result = apply({ rust: { enabled: false } });
    expect(result.definitions).toStrictEqual(servers());
    expect(result.problems).toStrictEqual([]);
  });
});
