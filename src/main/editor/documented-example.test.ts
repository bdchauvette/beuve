import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe } from 'vitest';

import { buildEditorArgv } from './build-editor-argv.ts';
import { editorDefinitions } from './editor-definitions.ts';
import { resolveEditorDefinitions } from './resolve-editor-definitions.ts';
import { test } from '../testing/test.ts';

/** The example docs/editors.md points to, parsed. */
async function readExample(signal: AbortSignal): Promise<Record<string, unknown>> {
  const file = path.resolve(import.meta.dirname, '../../../docs/examples/editors-settings.json');
  return JSON.parse(await readFile(file, { encoding: 'utf8', signal })) as Record<string, unknown>;
}

describe('docs/examples/editors-settings.json', () => {
  test('is a valid configuration: Cursor off, Zed moved, Helix in a terminal, Sublime Text', async ({
    expect,
    signal,
  }) => {
    const example = await readExample(signal);
    const { definitions, problems } = resolveEditorDefinitions({
      builtins: editorDefinitions,
      config: example['editors'],
    });
    expect(problems).toStrictEqual([]);
    expect(definitions.map(({ id }) => id)).toStrictEqual([
      'zed',
      'gram',
      'vscode',
      'helix',
      'sublime',
    ]);
    expect(example['preferredEditor']).toBe('gram');
    expect(
      buildEditorArgv(definitions[3]?.args ?? [], { file: '/r/a.ts', line: 3, column: 7 }),
    ).toStrictEqual(['--single-instance', 'hx', '/r/a.ts:3:7']);
  });
});
