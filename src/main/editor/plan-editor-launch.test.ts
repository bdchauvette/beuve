import { describe } from 'vitest';

import type { EditorLocation } from './editor-location.ts';
import { getEditorDefinition } from './testing/get-editor-definition.ts';
import { planEditorLaunch } from './plan-editor-launch.ts';
import { test } from '../testing/test.ts';

function target(): EditorLocation {
  return { file: '/repo/a.ts', line: 5, column: 2 };
}

describe('planEditorLaunch', () => {
  test('spawns the Zed CLI with path:line:column', ({ expect }) => {
    expect(
      planEditorLaunch(
        getEditorDefinition('zed'),
        { kind: 'cli', command: '/usr/local/bin/zed' },
        target(),
      ),
    ).toStrictEqual({
      kind: 'spawn',
      command: '/usr/local/bin/zed',
      args: ['/repo/a.ts:5:2'],
    });
  });

  test('spawns VS Code and Cursor with --goto', ({ expect }) => {
    const found = { kind: 'cli', command: '/bin/x' } as const;
    expect(planEditorLaunch(getEditorDefinition('vscode'), found, target())).toMatchObject({
      args: ['--goto', '/repo/a.ts:5:2'],
    });
    expect(planEditorLaunch(getEditorDefinition('cursor'), found, target())).toMatchObject({
      args: ['--goto', '/repo/a.ts:5:2'],
    });
  });

  test('uses the editor URL when no CLI was found', ({ expect }) => {
    expect(planEditorLaunch(getEditorDefinition('zed'), { kind: 'url' }, target())).toStrictEqual({
      kind: 'url',
      url: 'zed://file/repo/a.ts:5:2',
    });
    expect(
      planEditorLaunch(getEditorDefinition('vscode'), { kind: 'url' }, target()),
    ).toStrictEqual({
      kind: 'url',
      url: 'vscode://file/repo/a.ts:5:2',
    });
  });
});
