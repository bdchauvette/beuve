import { createInlineNode } from './create-inline-node.ts';
import { describeInsight } from './describe-insight.ts';
import type { ReviewInsight } from './merge-review-insights.ts';
import { parseInlineTitle } from './parse-inline-title.ts';
import { setInsightOpen } from './set-insight-open.ts';

/**
 * A `/review` finding as a quiet note under its line: one line (category and title, ellipsised),
 * which a click, Enter or Space, or keyboard focus, expands in place to the full body with Stage
 * and Show in chat ({@link setInsightOpen}). Escape collapses it. Built from text nodes only: the
 * finding is untrusted model output, so nothing here reaches `innerHTML`. It has no listeners:
 * the card delegates its `data-action`s (`insight`, `insight-line`, `insight-stage`,
 * `insight-show`; ADR 0074), and the note carries its insight's key in `data-insight-key`.
 */
export function createInsightElement(insight: ReviewInsight, isOpen: boolean): HTMLElement {
  const { finding } = insight;
  const labels = describeInsight(finding);
  const root = document.createElement('div');
  root.className = `insight ${finding.severity}${labels.isUnconfirmed ? ' unconfirmed' : ''}`;
  root.dataset['action'] = 'insight';
  root.dataset['insightKey'] = insight.key;

  const line = document.createElement('div');
  line.className = 'insight-line';
  line.dataset['action'] = 'insight-line';
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
  setInsightOpen(root, insight, isOpen);
  return root;
}

function textSpan(className: string, text: string): HTMLElement {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}
