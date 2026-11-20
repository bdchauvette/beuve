import type { UraSeverityView } from '#contract/ipc-contract.ts';

import { createAnnotationHead } from './create-annotation-head.ts';
import type { AnnotationMark } from './create-annotation-head.ts';
import { describeInsight } from './describe-insight.ts';
import type { ReviewInsight } from './merge-review-insights.ts';
import './primitives/beuve-agent-mark.ts';
import { setInsightOpen } from './set-insight-open.ts';
import { uraSeverityEmoji } from './ura-severity-emoji.ts';

/** The label a finding is staged with, unless the reviewer picks another (ADR 0131). */
const stagedLabels: Readonly<Record<ReviewInsight['finding']['severity'], UraSeverityView>> = {
  risk: 'issue',
  warning: 'issue',
  info: 'nitpick',
};

/**
 * A `/review` finding not yet staged, under its line (ADR 0061, 0155): the shared one-line head
 * (the emoji of the label it would be staged with, its title, Insight and Unconfirmed, then ✨
 * with where it came from), which opens in place on Enter, Space or a click to the full body with
 * Stage and Show in chat. A dashed border tells it from a staged note. Built from text nodes
 * only: the finding is untrusted model output, so nothing here reaches `innerHTML`. The card
 * delegates its `data-action`s (ADR 0074); the root carries `data-insight-key`.
 */
export function createInsightElement(insight: ReviewInsight, isOpen: boolean): HTMLElement {
  const { finding } = insight;
  const labels = describeInsight(finding);
  const root = document.createElement('div');
  root.classList.add('annotation', 'insight', finding.severity);
  root.classList.toggle('unconfirmed', labels.isUnconfirmed);
  root.dataset['insightKey'] = insight.key;
  root.dataset['annotationKey'] = `insight:${insight.key}`;
  const marks: AnnotationMark[] = [
    { kind: 'insight', text: 'Insight', title: `${labels.summary}; not staged` },
  ];
  if (labels.isUnconfirmed) {
    marks.push({
      kind: 'unconfirmed',
      text: 'Unconfirmed',
      title: 'The verification pass did not confirm it',
    });
  }
  const agent = document.createElement('beuve-agent-mark');
  agent.origin = {
    kind: 'chat-answer',
    messageId: insight.messageId,
    finding: insight.index,
    confidence: finding.confidence,
  };
  agent.focusable = true;
  root.append(
    createAnnotationHead({
      emoji: uraSeverityEmoji(stagedLabels[finding.severity]),
      emojiName: `${labels.severity} insight`,
      text: finding.title,
      isBodyText: false,
      marks,
      trailing: [agent],
    }),
  );
  setInsightOpen(root, insight, isOpen);
  return root;
}
