import { countUraSeverities } from './count-ura-severities.ts';
import { escapeMarkdownHtml } from './escape-markdown-html.ts';
import { fenceCodeBlock } from './fence-code-block.ts';
import { formatImpactOrigin } from './format-impact-origin.ts';
import { formatUraAnchor } from './format-ura-anchor.ts';
import { formatUraSeverity } from './format-ura-severity.ts';
import type { OutdatedReason, UraArtifact, UraEntry, UraVerdict } from './ura-artifact.ts';
import type { UraAnchor, UraOrigin } from './ura-item.ts';
import { uraSeverities } from './ura-severities.ts';

const verdictLabels: Readonly<Record<UraVerdict, string>> = {
  approve: 'Approve',
  'request-changes': 'Request changes',
  comment: 'Comment',
};

const originLabels: Readonly<Record<UraOrigin['kind'], string>> = {
  human: '',
  'agent-insight': 'from an agent insight',
  'impact-finding': 'from ImpactGate',
  'chat-answer': 'from chat',
};

const outdatedLabels: Readonly<Record<OutdatedReason, string>> = {
  'lines-changed': 'outdated, the lines changed since',
  'file-deleted': 'outdated, the file was deleted after',
  'no-line-mapping': 'outdated, written against',
};

const shortSha = 12;

/** A Markdown summary of an artifact for copying anywhere. Pure and deterministic. */
export function renderUraMarkdown(artifact: UraArtifact): string {
  const sections = [
    `# Review of ${changeName(artifact)}`,
    overview(artifact),
    ...artifact.entries.map((entry, index) => itemSection(entry, index + 1)),
  ];
  return `${sections.join('\n\n')}\n`;
}

function changeName({ summary }: UraArtifact): string {
  const { change } = summary;
  return change.kind === 'local'
    ? `\`${change.headRef}\` into \`${change.baseRef}\``
    : `${change.owner}/${change.repo}#${String(change.number)}`;
}

function overview(artifact: UraArtifact): string {
  const { summary, verdict } = artifact;
  const chosen =
    verdict.source === 'chosen'
      ? ` (chosen; the items suggest ${verdictLabels[verdict.derived].toLowerCase()})`
      : '';
  const range =
    summary.scope.kind === 'interdiff'
      ? `changes since ${commit(summary.scope.fromHeadSha)}, up to ${commit(summary.headSha)}`
      : `from ${commit(summary.baseSha)} to ${commit(summary.headSha)}`;
  const counts = countUraSeverities(artifact.entries);
  const tally = uraSeverities
    .filter((severity) => counts[severity] > 0)
    .map((severity) => `${String(counts[severity])} ${formatUraSeverity(severity).toLowerCase()}`)
    .join(', ');
  return [
    `- **Verdict:** ${verdictLabels[verdict.value]}${chosen}`,
    `- **Reviewed:** ${range}`,
    `- **Items:** ${tally === '' ? 'none' : tally}`,
  ].join('\n');
}

function itemSection({ item, placement }: UraEntry, number: number): string {
  const where =
    placement.kind === 'current'
      ? currentLocation(placement.anchor)
      : `\`${formatUraAnchor(item.anchor)}\` (${outdatedLabels[placement.reason]} ${commit(item.headSha)})`;
  const origin = originLabels[item.origin.kind];
  return [
    `## ${String(number)}. ${formatUraSeverity(item.severity)}: ${escapeMarkdownHtml(item.title)}`,
    origin === '' ? where : `${where}, ${origin}`,
    ...(item.body.trim() === '' ? [] : [item.body.trim()]),
    ...(item.origin.kind === 'impact-finding' ? [formatImpactOrigin(item.origin)] : []),
    ...(item.suggestion === undefined ? [] : [fenceCodeBlock('diff', item.suggestion.text)]),
  ].join('\n\n');
}

function currentLocation(anchor: UraAnchor): string {
  return anchor.kind === 'change' ? 'The whole change' : `\`${formatUraAnchor(anchor)}\``;
}

function commit(sha: string): string {
  return `\`${sha.slice(0, shortSha)}\``;
}
