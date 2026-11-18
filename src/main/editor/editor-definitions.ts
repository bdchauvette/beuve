import type { EditorId } from '#contract/ipc-contract.ts';

import type { EditorUrlScheme } from './build-editor-url.ts';

/**
 * How to find an editor and open `file:line:column` in it (ADR 0033, 0139). `executables` are
 * names looked up on PATH; `knownPaths` are absolute or start with `~/` for the home directory
 * (macOS GUI apps don't inherit the shell's PATH); `appBundles` are macOS apps whose `urlScheme`
 * is the fallback when no CLI is found. `args` is a template with `{file}`, `{line}` and
 * `{column}`. `origin` is `custom` when `settings.json` defines or changes the editor.
 */
export interface EditorDefinition {
  readonly id: EditorId;
  readonly name: string;
  readonly executables: readonly string[];
  readonly knownPaths: readonly string[];
  readonly appBundles: readonly string[];
  readonly urlScheme?: EditorUrlScheme;
  readonly args: readonly string[];
  readonly origin: 'built-in' | 'custom';
}

/** Zed's CLI, and Gram's (a fork of it), take `path:line:column` as one argument. */
const positionArgs: readonly string[] = Object.freeze(['{file}:{line}:{column}']);

/** VS Code and Cursor open a location with `--goto path:line:column`. */
const gotoArgs: readonly string[] = Object.freeze(['--goto', '{file}:{line}:{column}']);

/**
 * The editors beuve knows without configuration, in the order Settings lists them (ADR 0139). The
 * order no longer decides which one opens: the reviewer's choice does.
 */
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
    args: positionArgs,
    origin: 'built-in',
  },
  {
    id: 'gram',
    name: 'Gram',
    executables: ['gram'],
    knownPaths: [
      '/Applications/Gram.app/Contents/MacOS/cli',
      '/usr/local/bin/gram',
      '/opt/homebrew/bin/gram',
      '~/.local/bin/gram',
      '~/Applications/Gram.app/Contents/MacOS/cli',
    ],
    appBundles: ['/Applications/Gram.app', '~/Applications/Gram.app'],
    urlScheme: 'gram',
    args: positionArgs,
    origin: 'built-in',
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
    args: gotoArgs,
    origin: 'built-in',
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
    args: gotoArgs,
    origin: 'built-in',
  },
] satisfies EditorDefinition[]);
