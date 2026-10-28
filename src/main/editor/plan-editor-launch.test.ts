import { describe, expect, it } from 'vitest';

import { getEditorDefinition } from './testing/get-editor-definition.ts';
import { planEditorLaunch } from './plan-editor-launch.ts';

const zed = getEditorDefinition('zed');
const vscode = getEditorDefinition('vscode');
const cursor = getEditorDefinition('cursor');
const target = { file: '/repo/a.ts', line: 5, column: 2 };

describe('planEditorLaunch', () => {
  it('spawns the Zed CLI with path:line:column', () => {
    expect(planEditorLaunch(zed, { kind: 'cli', command: '/usr/local/bin/zed' }, target)).toEqual({
      kind: 'spawn',
      command: '/usr/local/bin/zed',
      args: ['/repo/a.ts:5:2'],
    });
  });

  it('spawns VS Code and Cursor with --goto', () => {
    const found = { kind: 'cli', command: '/bin/x' } as const;
    expect(planEditorLaunch(vscode, found, target)).toMatchObject({
      args: ['--goto', '/repo/a.ts:5:2'],
    });
    expect(planEditorLaunch(cursor, found, target)).toMatchObject({
      args: ['--goto', '/repo/a.ts:5:2'],
    });
  });

  it('uses the editor URL when no CLI was found', () => {
    expect(planEditorLaunch(zed, { kind: 'url' }, target)).toEqual({
      kind: 'url',
      url: 'zed://file/repo/a.ts:5:2',
    });
    expect(planEditorLaunch(vscode, { kind: 'url' }, target)).toEqual({
      kind: 'url',
      url: 'vscode://file/repo/a.ts:5:2',
    });
  });
});
