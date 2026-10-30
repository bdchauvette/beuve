import { createInlineNode } from './create-inline-node.ts';
import type { ReviewInsight } from './merge-review-insights.ts';
import { parseMarkdownSubset } from './parse-markdown-subset.ts';
import type { InlineSpan, MarkdownBlock } from './parse-markdown-subset.ts';

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
  text.append(...parseMarkdownSubset(finding.body).map((block) => blockNode(block)));
  const actions = document.createElement('div');
  actions.className = 'insight-actions';
  const stage = actionButton(
    'insight-stage',
    'Stage',
    'Stage this finding on its lines in the review dock',
  );
  const show = actionButton(
    'insight-show',
    'Show in chat',
    'Show this finding in the chat transcript',
  );
  const confidence = Math.round(finding.confidence * 100);
  actions.append(
    stage,
    show,
    textSpan('insight-meta', `${String(confidence)}% confidence · ${finding.check}`),
  );
  body.append(text, actions);
  return body;
}

function blockNode(block: MarkdownBlock): Node {
  switch (block.kind) {
    case 'paragraph': {
      return container('p', block.spans);
    }
    case 'list': {
      const list = document.createElement('ul');
      list.append(...block.items.map((item) => container('li', item)));
      return list;
    }
    case 'code': {
      const pre = document.createElement('pre');
      pre.textContent = block.text;
      return pre;
    }
  }
}

function container(tag: 'p' | 'li', spans: readonly InlineSpan[]): HTMLElement {
  const element = document.createElement(tag);
  element.append(...spans.map((span) => createInlineNode(span)));
  return element;
}

function textSpan(className: string, text: string): HTMLElement {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

function actionButton(action: string, label: string, title: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset['action'] = action;
  button.textContent = label;
  button.title = title;
  return button;
}
