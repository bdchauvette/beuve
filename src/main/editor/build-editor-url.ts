import type { EditorLocation } from './editor-location.ts';

export type EditorUrlScheme = 'zed' | 'vscode' | 'cursor';

/**
 * `<scheme>://file/<absolute path>:<line>:<column>`, the form VS Code, Cursor and Zed register on
 * macOS. Each path segment is percent-encoded so a name can't change the URL's shape.
 */
export function buildEditorUrl(
  scheme: EditorUrlScheme,
  { file, line, column }: EditorLocation,
): string {
  const encoded = file
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${scheme}://file${rooted(encoded)}:${String(line)}:${String(column)}`;
}

function rooted(encoded: string): string {
  if (encoded.startsWith('/')) {
    return encoded;
  }
  return `/${encoded}`;
}
