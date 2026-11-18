import { describe } from 'vitest';

import { buildEditorArgv } from './build-editor-argv.ts';
import { test } from '../testing/test.ts';

describe('buildEditorArgv', () => {
  test('fills the file, line and column into each argument', ({ expect }) => {
    const location = { file: '/repo/a.ts', line: 5, column: 2 };
    expect(buildEditorArgv(['{file}:{line}:{column}'], location)).toStrictEqual(['/repo/a.ts:5:2']);
    expect(buildEditorArgv(['--goto', '{file}:{line}:{column}'], location)).toStrictEqual([
      '--goto',
      '/repo/a.ts:5:2',
    ]);
    expect(buildEditorArgv(['+{line}', '{file}'], location)).toStrictEqual(['+5', '/repo/a.ts']);
  });

  test('keeps a path with spaces, quotes or placeholders one argument, unexpanded', ({
    expect,
  }) => {
    const location = { file: "/my repo/it's {line}.ts", line: 1, column: 1 };
    expect(buildEditorArgv(['--wait', '{file}'], location)).toStrictEqual([
      '--wait',
      "/my repo/it's {line}.ts",
    ]);
  });
});
