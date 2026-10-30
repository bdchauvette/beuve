import { createInlineNode } from './create-inline-node.ts';
import { describeInsight } from './describe-insight.ts';
import type { ReviewInsight } from './merge-review-insights.ts';
import { parseInlineTitle } from './parse-inline-title.ts';
import { parseMarkdownSubset } from './parse-markdown-subset.ts';
import type { InlineSpan, MarkdownBlock } from './parse-markdown-subset.ts';

/** What a diff card does for one insight note (ADR 0061). */
export interface InsightElementOptions {
  /** Whether the note starts expanded (the card remembers across re-renders). */
  readonly isOpen: boolean;
  readonly onToggle: (isOpen: boolean) => void;
  readonly onStage: () => void;
  readonly onShowInChat: () => void;
}

/**
 * A `/review` finding as a quiet note under its line: one line (category and title, ellipsised),
 * which a click, Enter or Space, or keyboard focus, expands in place to the full body with Stage
 * and Show in chat. Escape collapses it. Built from text nodes only: the finding is untrusted
 * model output, so nothing here reaches `innerHTML`.
 */
export function createInsightElement(
  insight: ReviewInsight,
  options: InsightElementOptions,
): HTMLElement {
  const { finding } = insight;
  const labels = describeInsight(finding);
  const root = document.createElement('div');
  root.className = `insight ${finding.severity}${labels.isUnconfirmed ? ' unconfirmed' : ''}`;
  root.dataset['insightKey'] = insight.key;

  const line = document.createElement('div');
  line.className = 'insight-line';
  line.tabIndex = 0;
  line.setAttribute('role', 'button');
  const plainTitle = parseInlineTitle(finding.title)
    .map((span) => span.text)
    .join('');
  line.setAttribute('aria-label', `${labels.summary}: ${plainTitle}`);
  const category = textSpan('insight-category', labels.category);
  const title = document.createElement('span');
  title.className = 'insight-title';
  title.append(...parseInlineTitle(finding.title).map((span) => createInlineNode(span)));
  line.append(category, title);
  if (labels.isUnconfirmed) {
    line.append(textSpan('insight-flag', 'unconfirmed'));
  }
  root.append(line);

  let body: HTMLElement | undefined;
  const setOpen = (isOpen: boolean): void => {
    line.setAttribute('aria-expanded', String(isOpen));
    root.classList.toggle('open', isOpen);
    if (isOpen && body === undefined) {
      body = createBody(insight, options);
      root.append(body);
    } else if (!isOpen && body !== undefined) {
      body.remove();
      body = undefined;
    }
  };
  const toggle = (isOpen: boolean): void => {
    setOpen(isOpen);
    options.onToggle(isOpen);
  };
  setOpen(options.isOpen);

  line.addEventListener('click', () => {
    toggle(!root.classList.contains('open'));
  });
  line.addEventListener('focus', () => {
    if (line.matches(':focus-visible') && !root.classList.contains('open')) {
      toggle(true);
    }
  });
  root.addEventListener('keydown', (event) => {
    const isOpen = root.classList.contains('open');
    if (event.target === line && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      event.stopPropagation();
      toggle(!isOpen);
    } else if (isOpen && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      toggle(false);
      line.focus({ preventScroll: true });
    }
  });
  return root;
}

function createBody(insight: ReviewInsight, options: InsightElementOptions): HTMLElement {
  const { finding } = insight;
  const body = document.createElement('div');
  body.className = 'insight-body';
  const text = document.createElement('div');
  text.className = 'insight-text';
  text.append(...parseMarkdownSubset(finding.body).map((block) => blockNode(block)));
  const actions = document.createElement('div');
  actions.className = 'insight-actions';
  const stage = actionButton('Stage', 'Stage this finding on its lines in the review dock');
  stage.addEventListener('click', options.onStage);
  const show = actionButton('Show in chat', 'Show this finding in the chat transcript');
  show.addEventListener('click', options.onShowInChat);
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

function actionButton(label: string, title: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.title = title;
  return button;
}
