import type { ChatReview } from './chat-review.ts';

/**
 * A `/review` answer as Markdown for later prompts (ADR 0055, 0072): a summary line, then every
 * finding with its `[[path:start-end]]` citation. Pure.
 */
export function reviewMarkdownFrom(review: ChatReview): string {
  const count = counted(review.findings.length, 'finding');
  let unconfirmed = '';
  if (review.dropped.unconfirmed > 0) {
    unconfirmed = `, ${String(review.dropped.unconfirmed)} dropped as unconfirmed`;
  }
  const header = `**Review** of ${counted(review.fileCount, 'file')}: ${count}${unconfirmed}.`;
  const items = review.findings.map((finding) => {
    return (
      `- **${finding.severity}, ${finding.category}** ${finding.title} ` +
      `[[${finding.path}:${String(finding.startLine)}-${String(finding.endLine)}]] ` +
      `(confidence ${finding.confidence.toFixed(2)}, ${finding.check}): ` +
      finding.body.replaceAll(/\s+/gu, ' ')
    );
  });
  if (items.length === 0) {
    return header;
  }
  return [header, '', ...items].join('\n');
}

/** `1 file`, `3 files`. */
function counted(count: number, noun: string): string {
  if (count === 1) {
    return `1 ${noun}`;
  }
  return `${String(count)} ${noun}s`;
}
