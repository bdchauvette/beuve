export type EditorUrlScheme = 'zed' | 'vscode' | 'cursor';

/**
 * `<scheme>://file/<absolute path>:<line>:<column>`, the form VS Code, Cursor and Zed register on
 * macOS. Each path segment is percent-encoded so a name can't change the URL's shape.
 */
export function buildEditorUrl(
  scheme: EditorUrlScheme,
  file: string,
  line: number,
  column: number,
): string {
  const encoded = file
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const rooted = encoded.startsWith('/') ? encoded : `/${encoded}`;
  return `${scheme}://file${rooted}:${String(line)}:${String(column)}`;
}
