import { createMarkdownNodes } from './create-markdown-nodes.ts';
import { createPlainMarkdownRenderers } from './create-plain-markdown-renderers.ts';
import { createTextSpan } from './create-text-span.ts';
import type { ReviewInsight } from './merge-review-insights.ts';
import { parseMarkdown } from './parse-markdown.ts';

/**
 * Expands or collapses an insight note made by `createInsightElement`: the full body, with Stage
 * and Show in chat, is built when it opens and dropped when it closes.
 */
export function setInsightOpen(root: HTMLElement, insight: ReviewInsight, isOpen: boolean): void {
  root.querySelector('.insight-line')?.setAttribute('aria-expanded', String(isOpen));
  root.classList.toggle('open', isOpen);
  const body = root.querySelector(':scope > .insight-body');
  if (isOpen && body === null) {
    root.append(createBody(insight));
  } else if (!isOpen && body !== null) {
    body.remove();
  }
}

function createBody(insight: ReviewInsight): HTMLElement {
  const { finding } = insight;
  const body = document.createElement('div');
  body.className = 'insight-body';
  const text = document.createElement('div');
  text.className = 'insight-text';
  text.append(...createMarkdownNodes(parseMarkdown(finding.body), createPlainMarkdownRenderers()));
  const actions = document.createElement('div');
  actions.className = 'insight-actions';
  const stage = actionButton({
    action: 'insight-stage',
    label: 'Stage',
    title: 'Stage this finding on its lines in the review dock',
  });
  const show = actionButton({
    action: 'insight-show',
    label: 'Show in chat',
    title: 'Show this finding in the chat transcript',
  });
  const confidence = Math.round(finding.confidence * 100);
  actions.append(
    stage,
    show,
    createTextSpan({
      className: 'insight-meta',
      text: `${String(confidence)}% confidence · ${finding.check}`,
    }),
  );
  body.append(text, actions);
  return body;
}

/** A delegated button (ADR 0074): its `data-action`, its text and its tooltip. */
interface ActionButtonParts {
  readonly action: string;
  readonly label: string;
  readonly title: string;
}

function actionButton({ action, label, title }: ActionButtonParts): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button';
  button.dataset['action'] = action;
  button.textContent = label;
  button.title = title;
  return button;
}
