import type { UraItemView } from '#contract/ipc-contract.ts';

import { createAnnotationHead } from './create-annotation-head.ts';
import { describeUraItem } from './describe-ura-item.ts';
import { noteMarksFrom } from './note-marks-from.ts';
import { splitPatch } from './split-patch.ts';
import { suggestionPreviewsFrom } from './suggestion-previews-from.ts';
import './primitives/beuve-agent-mark.ts';
import { uraSeverityEmoji } from './ura-severity-emoji.ts';

/** Where a note's lines are when the diff hides them. */
export interface NoteAnnotationOptions {
  /** `lines 120–124, outside the shown hunks`, for a button that reveals them. */
  readonly outside?: string;
}

/**
 * A note under its lines in the diff (ADR 0155): the shared one-line head (the label's emoji,
 * what the note says, its marks: Blocking, Posted, then ✨ for an agent's note). A click on it
 * opens the note's editor in its place (`edit-note`, ADR 0155 amendment), which shows the body and
 * the suggestion; there is no read-only open state. A delete button ends the head (`delete-note`). It carries `data-action="note"`, so a
 * double-click edits it too (ADR 0129).
 */
export function createNoteAnnotation(
  item: UraItemView,
  options: NoteAnnotationOptions,
): HTMLElement {
  const root = document.createElement('div');
  root.className = 'annotation note';
  root.dataset['action'] = 'note';
  root.dataset['uraItemId'] = item.id;
  const trailing: Node[] = [];
  if (item.origin.kind !== 'human') {
    const mark = document.createElement('beuve-agent-mark');
    mark.origin = item.origin;
    mark.focusable = true;
    trailing.push(mark);
  }
  if (options.outside !== undefined) {
    const reveal = document.createElement('button');
    reveal.type = 'button';
    reveal.className = 'annotation-reveal';
    reveal.dataset['action'] = 'reveal-note';
    reveal.dataset['uraItemId'] = item.id;
    reveal.title = 'Show these lines in the diff';
    reveal.textContent = options.outside;
    trailing.push(reveal);
  }
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'annotation-delete';
  remove.dataset['action'] = 'delete-note';
  remove.dataset['uraItemId'] = item.id;
  remove.title = 'Delete this note';
  remove.setAttribute('aria-label', 'Delete this note');
  remove.textContent = '🗑';
  trailing.push(remove);
  const text = noteText(item);
  const head = createAnnotationHead({
    emoji: uraSeverityEmoji(item.severity),
    emojiName: describeUraItem(item).severityName,
    text: text.text,
    isBodyText: text.isBodyText,
    marks: noteMarksFrom(item),
    trailing,
    opens: 'editor',
  });
  head.dataset['uraItemId'] = item.id;
  const toggle = head.querySelector<HTMLElement>('.annotation-toggle');
  if (toggle !== null) {
    toggle.dataset['uraItemId'] = item.id;
    toggle.title = 'Edit this note';
  }
  root.append(head);
  return root;
}

/** One line of what the note says, and whether it is body text rather than a title. */
interface NoteText {
  readonly text: string;
  readonly isBodyText: boolean;
}

/** The title; else the body's first line; else the suggestion's first added line, as code. */
function noteText(item: UraItemView): NoteText {
  if (item.title !== '') {
    return { text: item.title, isBodyText: false };
  }
  const [line = ''] = item.body.trim().split('\n', 1);
  const previews = suggestionPreviewsFrom(item);
  if (line !== '' || previews.length === 0) {
    return { text: line, isBodyText: true };
  }
  const added = previews
    .flatMap((preview) => splitPatch(preview.patch))
    .find((patchLine) => patchLine.kind === 'added')?.text;
  if (added === undefined) {
    return { text: 'Suggests removing these lines', isBodyText: true };
  }
  return { text: `\`${added.slice(1).trim()}\``, isBodyText: true };
}
