import type { EditorLocation } from './editor-location.ts';

/** Zed's CLI takes `path:line:column` as one argument (`zed myfile.txt:42:10`). */
export function buildZedArgv({ file, line, column }: EditorLocation): string[] {
  return [`${file}:${String(line)}:${String(column)}`];
}
