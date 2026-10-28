import type { EditorOpenResponse } from '#contract/ipc-contract.ts';

/** A status-bar message. */
export interface StatusNotice {
  readonly tone: 'info' | 'error';
  readonly text: string;
}

/** What the status bar says after `o`; a beuve checkout is called out as not the reviewer's own. */
export function describeEditorOpen(response: EditorOpenResponse): StatusNotice {
  if (response.kind === 'failed') {
    return { tone: 'error', text: response.message };
  }
  const where = `${response.path}:${String(response.line)}`;
  const copy =
    response.location === 'beuve-checkout'
      ? ' (beuve checkout of the reviewed head, not your working tree)'
      : '';
  return { tone: 'info', text: `Opened ${where} in ${response.editorName}${copy}.` };
}
