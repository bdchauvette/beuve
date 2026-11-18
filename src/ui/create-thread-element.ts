import type { ReviewThreadView } from '#contract/ipc-contract.ts';

import { createMarkdownNodes } from './create-markdown-nodes.ts';
import { createPlainMarkdownRenderers } from './create-plain-markdown-renderers.ts';
import { createTextSpan } from './create-text-span.ts';
import { describeThreadPlace } from './describe-thread-place.ts';
import { parseMarkdown } from './parse-markdown.ts';

/** How a thread is introduced: under its lines, or in the card's list with where it was. */
export interface ThreadElementOptions {
  /** Names the thread's place (`lines 3–4`, `outdated`), for the card's list. */
  readonly showsPlace: boolean;
}

/**
 * Another reviewer's thread as a quiet block (ADR 0140): each comment's author, time and Markdown
 * body, and a button that opens the comment on its host. The comments are untrusted, so this is
 * built from text nodes and the Markdown node builder only (ADR 0073, 0077); nothing reaches
 * `innerHTML`. It has no listeners: the card delegates `data-action="thread-open"` and the links
 * in a body (`link`, ADR 0074).
 */
export function createThreadElement(
  thread: ReviewThreadView,
  { showsPlace }: ThreadElementOptions,
): HTMLElement {
  const root = document.createElement('div');
  root.classList.add('thread');
  if (thread.isOutdated) {
    root.classList.add('outdated');
  }
  root.dataset['threadId'] = thread.id;
  if (showsPlace) {
    root.append(createTextSpan({ className: 'thread-place', text: describeThreadPlace(thread) }));
  }
  for (const comment of thread.comments) {
    root.append(commentElement(comment));
  }
  return root;
}

function commentElement(comment: ReviewThreadView['comments'][number]): HTMLElement {
  const element = document.createElement('div');
  element.className = 'thread-comment';
  const header = document.createElement('div');
  header.className = 'thread-header';
  const time = document.createElement('beuve-time');
  time.setAttribute('datetime', comment.at);
  time.setAttribute('time-style', 'short');
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'thread-open';
  open.dataset['action'] = 'thread-open';
  open.dataset['url'] = comment.url;
  open.title = 'Open this comment on its page';
  open.textContent = 'Open';
  header.append(createTextSpan({ className: 'thread-author', text: comment.author }), time, open);
  const body = document.createElement('div');
  body.className = 'thread-body';
  body.append(...createMarkdownNodes(parseMarkdown(comment.body), createPlainMarkdownRenderers()));
  element.append(header, body);
  return element;
}
