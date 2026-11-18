import type { StatusNotice } from './describe-editor-open.ts';

/** Whether Undo Delete Note put a deletion back, and how many notes it held. */
export interface NoteRestore {
  readonly isRestored: boolean;
  readonly count: number;
}

/** The notice after Undo Delete Note, in the singular or the plural (ADR 0143). Pure. */
export function describeNoteRestore({ isRestored, count }: NoteRestore): StatusNotice {
  const isPlural = count > 1;
  if (isRestored && isPlural) {
    return { tone: 'info', text: 'Notes restored.' };
  }
  if (isRestored) {
    return { tone: 'info', text: 'Note restored.' };
  }
  if (isPlural) {
    return { tone: 'error', text: 'Those notes can no longer be restored.' };
  }
  return { tone: 'error', text: 'That note can no longer be restored.' };
}
