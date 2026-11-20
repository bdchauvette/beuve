import type { UraItemView } from '#contract/ipc-contract.ts';

import { createAnnotationHead } from './create-annotation-head.ts';
import { describeUraItem } from './describe-ura-item.ts';
import { noteMarksFrom } from './note-marks-from.ts';
import './primitives/beuve-agent-mark.ts';
import { setNoteOpen } from './set-note-open.ts';
import { uraSeverityEmoji } from './ura-severity-emoji.ts';

/** How a note's annotation starts: open or not, and where its lines are when the diff hides them. */
export interface NoteAnnotationOptions {
  readonly isOpen: boolean;
  /** `lines 120–124, outside the shown hunks`, for a button that reveals them. */
  readonly outside?: string;
}

/**
 * A note under its lines in the diff (ADR 0155): the shared one-line head (the label's emoji,
 * what the note says, its marks: Blocking, Posted, then ✨ for an agent's note) that opens in
 * place to its body, suggestion and Edit. It carries `data-action="note"`, so a double-click
 * edits it (ADR 0129), and `data-annotation-key` for the card's open state.
 */
export function createNoteAnnotation(
  item: UraItemView,
  options: NoteAnnotationOptions,
): HTMLElement {
  const root = document.createElement('div');
  root.className = 'annotation note';
  root.dataset['action'] = 'note';
  root.dataset['uraItemId'] = item.id;
  root.dataset['annotationKey'] = `ura:${item.id}`;
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
  const text = noteText(item);
  root.append(
    createAnnotationHead({
      emoji: uraSeverityEmoji(item.severity),
      emojiName: describeUraItem(item).severityName,
      text: text.text,
      isBodyText: text.isBodyText,
      marks: noteMarksFrom(item),
      trailing,
    }),
  );
  setNoteOpen(root, item, options.isOpen);
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
  if (line !== '' || item.suggestedPatch === undefined) {
    return { text: line, isBodyText: true };
  }
  const added = item.suggestedPatch
    .split('\n')
    .find((patchLine) => patchLine.startsWith('+') && !patchLine.startsWith('+++'));
  if (added === undefined) {
    return { text: 'Suggests removing these lines', isBodyText: true };
  }
  return { text: `\`${added.slice(1).trim()}\``, isBodyText: true };
}
