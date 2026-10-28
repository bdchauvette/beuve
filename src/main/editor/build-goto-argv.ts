/** VS Code and Cursor open a location with `--goto path:line:column`. */
export function buildGotoArgv(file: string, line: number, column: number): string[] {
  return ['--goto', `${file}:${String(line)}:${String(column)}`];
}
