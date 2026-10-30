import type { ChatReview } from './chat-review.ts';

/**
 * A `/review` answer as Markdown for later prompts (ADR 0055, 0072): a summary line, then every
 * finding with its `[[path:start-end]]` citation. Pure.
 */
export function reviewMarkdownFrom(review: ChatReview): string {
  const count = `${String(review.findings.length)} ${review.findings.length === 1 ? 'finding' : 'findings'}`;
  const unconfirmed =
    review.dropped.unconfirmed === 0
      ? ''
      : `, ${String(review.dropped.unconfirmed)} dropped as unconfirmed`;
  const header = `**Review** of ${String(review.fileCount)} ${review.fileCount === 1 ? 'file' : 'files'}: ${count}${unconfirmed}.`;
  const items = review.findings.map(
    (finding) =>
      `- **${finding.severity}, ${finding.category}** ${finding.title} ` +
      `[[${finding.path}:${String(finding.startLine)}-${String(finding.endLine)}]] ` +
      `(confidence ${finding.confidence.toFixed(2)}, ${finding.check}): ` +
      finding.body.replaceAll(/\s+/gu, ' '),
  );
  return [header, ...(items.length === 0 ? [] : ['', ...items])].join('\n');
}
