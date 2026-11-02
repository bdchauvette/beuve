import { countUraSeverities } from './count-ura-severities.ts';
import { formatUraSeverity } from './format-ura-severity.ts';
import type { UraArtifact, UraVerdict } from './ura-artifact.ts';
import { uraSeverities } from './ura-severities.ts';

const verdictLabels: Readonly<Record<UraVerdict, string>> = {
  approve: 'Approved',
  'request-changes': 'Changes requested',
  comment: 'Comments',
};

/**
 * The default top of a review body, which the reviewer may rewrite before posting: how many
 * items of each severity the artifact carries (`1 blocker, 2 nits.`), or the verdict's name when
 * it carries none, so the body is never empty.
 */
export function reviewSummaryFrom(artifact: Pick<UraArtifact, 'entries' | 'verdict'>): string {
  const counts = countUraSeverities(artifact.entries);
  const tally = uraSeverities
    .filter((severity) => counts[severity] > 0)
    .map((severity) => `${String(counts[severity])} ${formatUraSeverity(severity).toLowerCase()}`)
    .join(', ');
  if (tally === '') {
    return verdictLabels[artifact.verdict.value];
  }
  return `${tally}.`;
}
