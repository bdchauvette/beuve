import type { EditorOpenResponse } from '#contract/ipc-contract.ts';
import { revealFormatControls } from '#x/text/reveal-format-controls.ts';

/** A status-bar message. */
export interface StatusNotice {
  readonly tone: 'info' | 'error';
  readonly text: string;
}

/** What the status bar says after Open in Editor; a beuve checkout is called out as not the reviewer's own. */
export function describeEditorOpen(response: EditorOpenResponse): StatusNotice {
  if (response.kind === 'failed') {
    return { tone: 'error', text: response.message };
  }
  const where = `${revealFormatControls(response.path)}:${String(response.line)}`;
  const opened = `Opened ${where} in ${response.editorName}`;
  if (response.location === 'beuve-checkout') {
    return {
      tone: 'info',
      text: `${opened} (read-only beuve checkout of the reviewed head, not your working tree).`,
    };
  }
  return { tone: 'info', text: `${opened}.` };
}
