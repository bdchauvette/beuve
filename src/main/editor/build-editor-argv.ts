import type { EditorLocation } from './editor-location.ts';

const placeholder = /\{(?<name>file|line|column)\}/gu;

/**
 * An editor's argument template with `{file}`, `{line}` and `{column}` filled in (ADR 0139). Each
 * template entry stays one argument whatever the path holds: nothing is split or run by a shell.
 */
export function buildEditorArgv(
  template: readonly string[],
  { file, line, column }: EditorLocation,
): string[] {
  const values: Readonly<Record<string, string>> = {
    file,
    line: String(line),
    column: String(column),
  };
  return template.map((argument) => {
    return argument.replaceAll(placeholder, (_match, name: string): string => {
      return values[name] ?? '';
    });
  });
}
