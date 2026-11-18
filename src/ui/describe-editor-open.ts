import type { CommandId } from '#contract/command-catalog.ts';
import type { EditorOpenFailure, EditorOpenResponse } from '#contract/ipc-contract.ts';
import { revealFormatControls } from '#x/text/reveal-format-controls.ts';

/** A status-bar message, with at most one command the reviewer can run from it. */
export interface StatusNotice {
  readonly tone: 'info' | 'error';
  readonly text: string;
  readonly action?: StatusNoticeAction;
}

/** A button on a notice that runs a catalog command (ADR 0068). */
export interface StatusNoticeAction {
  readonly label: string;
  readonly command: CommandId;
}

/** The failures the reviewer fixes by choosing or configuring an editor. */
const choiceFailures: ReadonlySet<EditorOpenFailure> = new Set([
  'no-editor-found',
  'editor-not-chosen',
  'editor-unavailable',
]);

/**
 * What the status bar says after Open in Editor. beuve's checkout is writable, but it is
 * read-only by convention (ADR 0033, amended by ADR 0095): edits there aren't kept, so the notice
 * says so in one line and offers Review Edits (ADR 0088). When no editor could be chosen, the
 * notice offers Editor Settings… (ADR 0141).
 */
export function describeEditorOpen(response: EditorOpenResponse): StatusNotice {
  if (response.kind === 'failed') {
    if (choiceFailures.has(response.failure)) {
      return {
        tone: 'error',
        text: response.message,
        action: { label: 'Editor Settings…', command: 'editor-settings' },
      };
    }
    return { tone: 'error', text: response.message };
  }
  const where = `${revealFormatControls(response.path)}:${String(response.line)}`;
  const opened = `Opened ${where} in ${response.editorName}`;
  if (response.location === 'beuve-checkout') {
    const short = response.headSha.slice(0, 7);
    return {
      tone: 'info',
      text: `${opened}: beuve’s checkout at ${short}; edits here aren’t kept, use Review Edits.`,
      action: { label: 'Open Review Edits', command: 'open-review-edits' },
    };
  }
  return { tone: 'info', text: `${opened}.` };
}
