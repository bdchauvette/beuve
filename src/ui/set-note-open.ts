import type { UraItemView } from '#contract/ipc-contract.ts';

import './beuve-patch-preview.ts';
import { createMarkdownNodes } from './create-markdown-nodes.ts';
import { createPlainMarkdownRenderers } from './create-plain-markdown-renderers.ts';
import { parseMarkdown } from './parse-markdown.ts';
import { setAnnotationOpen } from './set-annotation-open.ts';

/**
 * Opens or closes a note made by `createNoteAnnotation` (ADR 0155): open, it shows the note's
 * body, its suggestion as a diff, and Edit (`edit-note`, which edits it in the diff).
 */
export function setNoteOpen(root: HTMLElement, item: UraItemView, isOpen: boolean): void {
  setAnnotationOpen(
    root,
    (): HTMLElement => {
      return createNoteBody(item);
    },
    isOpen,
  );
}

function createNoteBody(item: UraItemView): HTMLElement {
  const body = document.createElement('div');
  if (item.body.trim() !== '') {
    const text = document.createElement('div');
    text.className = 'annotation-markdown';
    text.append(...createMarkdownNodes(parseMarkdown(item.body), createPlainMarkdownRenderers()));
    body.append(text);
  }
  if (item.suggestedPatch !== undefined) {
    const preview = document.createElement('beuve-patch-preview');
    preview.patch = item.suggestedPatch;
    body.append(preview);
  }
  const actions = document.createElement('div');
  actions.className = 'annotation-actions';
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'button';
  edit.dataset['action'] = 'edit-note';
  edit.dataset['uraItemId'] = item.id;
  edit.title = 'Edit this note here';
  edit.textContent = 'Edit';
  actions.append(edit);
  body.append(actions);
  return body;
}
