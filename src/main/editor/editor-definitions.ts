import type { EditorId } from '#contract/ipc-contract.ts';

import { buildGotoArgv } from './build-goto-argv.ts';
import { buildZedArgv } from './build-zed-argv.ts';
import type { EditorUrlScheme } from './build-editor-url.ts';

/**
 * How to find an editor and open `file:line:column` in it. `knownPaths` start with `~/` for the
 * home directory; `appBundles` are macOS apps whose `zed://`-style URL scheme is the fallback
 * when no CLI is found. macOS GUI apps don't inherit the shell's PATH, hence `knownPaths`.
 */
export interface EditorDefinition {
  readonly id: EditorId;
  readonly name: string;
  readonly executables: readonly string[];
  readonly knownPaths: readonly string[];
  readonly appBundles: readonly string[];
  readonly urlScheme: EditorUrlScheme;
  readonly buildArgv: (file: string, line: number, column: number) => string[];
}

/** Editors in order of preference (ADR 0033): Zed, VS Code, Cursor. */
export const editorDefinitions: readonly EditorDefinition[] = Object.freeze([
  {
    id: 'zed',
    name: 'Zed',
    executables: ['zed', 'zeditor'],
    knownPaths: [
      '/Applications/Zed.app/Contents/MacOS/cli',
      '/usr/local/bin/zed',
      '/opt/homebrew/bin/zed',
      '~/.local/bin/zed',
      '~/Applications/Zed.app/Contents/MacOS/cli',
    ],
    appBundles: ['/Applications/Zed.app', '~/Applications/Zed.app'],
    urlScheme: 'zed',
    buildArgv: buildZedArgv,
  },
  {
    id: 'vscode',
    name: 'VS Code',
    executables: ['code'],
    knownPaths: [
      '/usr/local/bin/code',
      '/opt/homebrew/bin/code',
      '~/.local/bin/code',
      '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
    ],
    appBundles: ['/Applications/Visual Studio Code.app', '~/Applications/Visual Studio Code.app'],
    urlScheme: 'vscode',
    buildArgv: buildGotoArgv,
  },
  {
    id: 'cursor',
    name: 'Cursor',
    executables: ['cursor'],
    knownPaths: [
      '/usr/local/bin/cursor',
      '/opt/homebrew/bin/cursor',
      '~/.local/bin/cursor',
      '/Applications/Cursor.app/Contents/Resources/app/bin/cursor',
    ],
    appBundles: ['/Applications/Cursor.app', '~/Applications/Cursor.app'],
    urlScheme: 'cursor',
    buildArgv: buildGotoArgv,
  },
]);
