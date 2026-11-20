import type { ReviewThreadView } from '#contract/ipc-contract.ts';

import { countNoun } from './count-noun.ts';
import { createAnnotationHead } from './create-annotation-head.ts';
import type { AnnotationMark } from './create-annotation-head.ts';
import { setThreadOpen } from './set-thread-open.ts';

/**
 * Another reviewer's thread under its lines (ADR 0140, 0155), collapsed by default to the shared
 * one-line head: 💬, the first comment's first line, and its author, the number of replies and
 * Resolved as marks. Enter, Space or a click opens it to every comment; `data-annotation-key`
 * keeps it open across re-renders.
 */
export function createThreadAnnotation(thread: ReviewThreadView, isOpen: boolean): HTMLElement {
  const root = document.createElement('div');
  root.className = 'annotation thread-annotation';
  root.dataset['threadId'] = thread.id;
  root.dataset['annotationKey'] = `thread:${thread.id}`;
  const [first] = thread.comments;
  const [line = ''] = (first?.body ?? '').trim().split('\n', 1);
  const marks: AnnotationMark[] = [];
  if (first !== undefined) {
    marks.push({ kind: 'author', text: first.author, title: `Started by ${first.author}` });
  }
  if (thread.comments.length > 1) {
    const replies = countNoun(thread.comments.length - 1, { one: 'reply', other: 'replies' });
    marks.push({ kind: 'replies', text: replies, title: replies });
  }
  if (thread.isResolved === true) {
    marks.push({ kind: 'resolved', text: 'Resolved', title: 'Resolved on its host' });
  }
  root.append(
    createAnnotationHead({
      emoji: '💬',
      emojiName: 'Comment thread',
      text: line,
      isBodyText: true,
      marks,
      trailing: [],
    }),
  );
  setThreadOpen(root, thread, isOpen);
  return root;
}
