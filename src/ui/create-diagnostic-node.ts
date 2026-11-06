import type { DiagnosticItemView } from '#contract/ipc-contract.ts';
import { revealFormatControls } from '#x/text/reveal-format-controls.ts';

/**
 * One diagnostic as the hover card shows it: the server's message, then where it came from (the
 * tool it names and its code). All of it is the server's text, shown as text with invisible and
 * bidirectional controls made visible (ADR 0082), never as markup.
 */
export function createDiagnosticNode(item: DiagnosticItemView): HTMLElement {
  const node = document.createElement('div');
  node.className = `diagnostic ${item.severity}`;
  const message = document.createElement('span');
  message.className = 'diagnostic-message';
  message.textContent = revealFormatControls(item.message);
  node.append(message);
  const origin = originOf(item);
  if (origin !== '') {
    const note = document.createElement('span');
    note.className = 'diagnostic-origin';
    note.textContent = ` ${revealFormatControls(origin)}`;
    node.append(note);
  }
  return node;
}

function originOf(item: DiagnosticItemView): string {
  const source = item.source ?? item.serverId;
  if (item.code === undefined) {
    return `(${source})`;
  }
  return `(${source} ${item.code})`;
}
