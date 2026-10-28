/** Zed's CLI takes `path:line:column` as one argument (`zed myfile.txt:42:10`). */
export function buildZedArgv(file: string, line: number, column: number): string[] {
  return [`${file}:${String(line)}:${String(column)}`];
}
