const extensions: Readonly<Record<string, string>> = Object.freeze({
  typescript: 'ts',
  javascript: 'js',
  markdown: 'md',
  shell: 'sh',
  shellscript: 'sh',
  console: 'sh',
  python: 'py',
  rust: 'rs',
  golang: 'go',
  yaml: 'yml',
  text: 'txt',
  plaintext: 'txt',
});

const extension = /^[a-z0-9+#-]{1,16}$/u;

/**
 * A file name for a fenced code block's info string (`ts`, `typescript`, `bash`, …), so the
 * highlighter picks its grammar from the extension as it does for files (ADR 0025, 0073). An
 * empty or odd info string gives a `.txt` name, which renders unhighlighted. Pure.
 */
export function snippetPathFrom(info: string): string {
  const language = info.trim().toLowerCase();
  const named = extensions[language] ?? language;
  if (!extension.test(named)) {
    return 'snippet.txt';
  }
  return `snippet.${named}`;
}
