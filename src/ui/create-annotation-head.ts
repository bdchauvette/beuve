import { createInlineNode } from './create-inline-node.ts';
import { createTextSpan } from './create-text-span.ts';
import type { NoteMark } from './note-marks-from.ts';
import { parseInlineTitle } from './parse-inline-title.ts';

/** A mark on an annotation's head: a note's (ADR 0154) or an insight's or thread's own. */
export interface AnnotationMark {
  readonly kind: NoteMark['kind'] | 'insight' | 'unconfirmed' | 'author' | 'replies' | 'resolved';
  readonly text: string;
  readonly title: string;
}

/** What an annotation's head shows (ADR 0155). */
export interface AnnotationHeadParts {
  /** The emoji in the head's first column, and its name for screen readers and the tooltip. */
  readonly emoji: string;
  readonly emojiName: string;
  /** What the annotation says, as inline Markdown on one line. */
  readonly text: string;
  /** The text is a body's first line rather than a title: regular weight. */
  readonly isBodyText: boolean;
  readonly marks: readonly AnnotationMark[];
  /** Controls after the marks (✨, a button that reveals hidden lines), which keep their clicks. */
  readonly trailing: readonly Node[];
  /**
   * What a click on the head does: open the annotation in place (an insight, a thread), or open
   * the note's editor in the diff (`edit-note`, ADR 0155 amendment).
   */
  readonly opens: 'in-place' | 'editor';
}

/**
 * The one-line head every annotation under a diff line shares (ADR 0155): a toggle button (the
 * emoji and what the annotation says, ellipsized), the marks, any trailing controls, and a
 * chevron. A click on the head outside its controls does what the toggle does: opens the
 * annotation in place (`annotation-toggle`, with `aria-expanded` and the chevron), or opens the
 * note's editor (`edit-note`, no chevron). Built from text nodes only (ADR 0077).
 */
export function createAnnotationHead(parts: AnnotationHeadParts): HTMLElement {
  const action = actionOf(parts.opens);
  const head = document.createElement('div');
  head.className = 'annotation-head';
  head.dataset['action'] = action;
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'annotation-toggle';
  toggle.dataset['action'] = action;
  if (parts.opens === 'in-place') {
    toggle.setAttribute('aria-expanded', 'false');
  }
  const emoji = createTextSpan({ className: 'annotation-emoji', text: parts.emoji });
  emoji.setAttribute('role', 'img');
  emoji.setAttribute('aria-label', parts.emojiName);
  emoji.title = parts.emojiName;
  const text = document.createElement('span');
  text.className = 'annotation-text';
  text.classList.toggle('body', parts.isBodyText);
  text.append(...parseInlineTitle(parts.text).map((span) => createInlineNode(span)));
  toggle.append(emoji, text);
  head.append(toggle);
  if (parts.marks.length > 0) {
    const marks = document.createElement('span');
    marks.className = 'annotation-marks';
    marks.append(
      ...parts.marks.map((mark) => {
        const element = createTextSpan({
          className: `annotation-mark mark-${mark.kind}`,
          text: mark.text,
        });
        element.title = mark.title;
        return element;
      }),
    );
    head.append(marks);
  }
  head.append(...parts.trailing);
  if (parts.opens === 'in-place') {
    const chevron = createTextSpan({ className: 'annotation-chevron', text: '' });
    chevron.setAttribute('aria-hidden', 'true');
    head.append(chevron);
  }
  return head;
}

function actionOf(opens: AnnotationHeadParts['opens']): string {
  if (opens === 'editor') {
    return 'edit-note';
  }
  return 'annotation-toggle';
}
