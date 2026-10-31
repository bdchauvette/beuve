import type { EditorLocation } from './editor-location.ts';

/** VS Code and Cursor open a location with `--goto path:line:column`. */
export function buildGotoArgv({ file, line, column }: EditorLocation): string[] {
  return ['--goto', `${file}:${String(line)}:${String(column)}`];
}
