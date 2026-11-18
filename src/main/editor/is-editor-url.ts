const allowedProtocols: ReadonlySet<string> = new Set(['zed:', 'gram:', 'vscode:', 'cursor:']);

/**
 * Whether `value` is a `zed://`, `gram://`, `vscode://` or `cursor://` file URL: the only URLs main
 * hands to `shell.openExternal` (ADR 0033, 0141). Reviewer-defined editors have no URL form.
 * Anything else, whatever its origin, is refused.
 */
export function isEditorUrl(value: string): boolean {
  if (!URL.canParse(value)) {
    return false;
  }
  const url = new URL(value);
  return (
    allowedProtocols.has(url.protocol) &&
    url.hostname === 'file' &&
    url.username === '' &&
    url.password === '' &&
    url.search === '' &&
    url.hash === ''
  );
}
