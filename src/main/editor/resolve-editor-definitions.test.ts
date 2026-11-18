import { describe } from 'vitest';

import { editorDefinitions } from './editor-definitions.ts';
import { resolveEditorDefinitions } from './resolve-editor-definitions.ts';
import { test } from '../testing/test.ts';

function resolved(config: unknown): ReturnType<typeof resolveEditorDefinitions> {
  return resolveEditorDefinitions({ builtins: editorDefinitions, config });
}

describe('resolveEditorDefinitions', () => {
  test('keeps the built-ins as they are without a configuration', ({ expect }) => {
    expect(resolved(undefined)).toStrictEqual({ definitions: editorDefinitions, problems: [] });
  });

  test('adds an editor of the reviewer’s own after the built-ins', ({ expect }) => {
    const { definitions, problems } = resolved({
      helix: { name: 'Helix', command: 'kitty', args: ['hx', '{file}:{line}:{column}'] },
      sublime: { command: '/opt/sublime_text/subl' },
      micro: { command: '~/bin/micro', args: ['+{line}:{column}', '{file}'] },
    });
    expect(problems).toStrictEqual([]);
    expect(definitions.map(({ id }) => id)).toStrictEqual([
      'zed',
      'gram',
      'vscode',
      'cursor',
      'helix',
      'sublime',
      'micro',
    ]);
    expect(definitions.slice(4)).toStrictEqual([
      {
        id: 'helix',
        name: 'Helix',
        executables: ['kitty'],
        knownPaths: [],
        appBundles: [],
        args: ['hx', '{file}:{line}:{column}'],
        origin: 'custom',
      },
      {
        id: 'sublime',
        name: 'sublime',
        executables: [],
        knownPaths: ['/opt/sublime_text/subl'],
        appBundles: [],
        args: ['{file}'],
        origin: 'custom',
      },
      {
        id: 'micro',
        name: 'micro',
        executables: [],
        knownPaths: ['~/bin/micro'],
        appBundles: [],
        args: ['+{line}:{column}', '{file}'],
        origin: 'custom',
      },
    ]);
  });

  test('changes the fields a built-in’s entry names, and removes a disabled one', ({ expect }) => {
    const { definitions, problems } = resolved({
      cursor: { enabled: false },
      vscode: { enabled: true },
      zed: { command: '/opt/zed/bin/zed' },
      gram: { name: 'Gram Dev', args: ['--new', '{file}:{line}:{column}'] },
    });
    expect(problems).toStrictEqual([]);
    expect(definitions.map(({ id, origin }) => `${id}:${origin}`)).toStrictEqual([
      'zed:custom',
      'gram:custom',
      'vscode:built-in',
    ]);
    expect(definitions[0]).toStrictEqual({
      id: 'zed',
      name: 'Zed',
      executables: [],
      knownPaths: ['/opt/zed/bin/zed'],
      appBundles: [],
      args: ['{file}:{line}:{column}'],
      origin: 'custom',
    });
    expect(definitions[1]).toMatchObject({
      name: 'Gram Dev',
      executables: ['gram'],
      urlScheme: 'gram',
      args: ['--new', '{file}:{line}:{column}'],
    });
  });

  test('leaves out an invalid entry, says why, and keeps the others', ({ expect }) => {
    const { definitions, problems } = resolved({
      helix: { command: 'hx', args: ['{path}'] },
      vim: { name: 'Vim' },
      'Bad Id': { command: 'x' },
      nano: { command: 'bin/nano' },
      kate: { command: 'kate', args: ['--line', '{line}'] },
      emacs: { command: 'emacsclient', wait: true },
      micro: 'micro',
      code2: { command: 'code', args: ['{file}'] },
    });
    expect(definitions.map(({ id }) => id).slice(4)).toStrictEqual(['code2']);
    expect(problems).toStrictEqual([
      'editors.helix.args.0: only {file}, {line} and {column} are filled in; editors.helix.args: one argument must hold {file}',
      'editors.Bad Id: an editor id is lowercase letters, digits and dashes, starting with a letter',
      'editors.nano.command: an absolute path, a path starting with ~/, or a program name found on PATH',
      'editors.kate.args: one argument must hold {file}',
      expect.stringMatching(/^editors\.emacs: .*wait/u) as string,
      expect.stringMatching(/^editors\.micro: /u) as string,
      'editors.vim: a new editor needs a "command"',
    ]);
  });

  test('reports an `editors` value that is not an object', ({ expect }) => {
    // eslint-disable-next-line unicorn/no-null -- JSON has null, and settings.json can hold it.
    for (const config of [[], 'zed', 3, null]) {
      expect(resolved(config)).toStrictEqual({
        definitions: editorDefinitions,
        problems: ['editors: expected an object of editors by id, such as { "helix": { … } }'],
      });
    }
  });
});
