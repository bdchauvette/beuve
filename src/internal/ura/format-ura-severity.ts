import type { UraSeverity } from './ura-severities.ts';

const labels: Readonly<Record<UraSeverity, string>> = {
  blocker: 'Blocker',
  issue: 'Issue',
  question: 'Question',
  nit: 'Nit',
  praise: 'Praise',
};

/** The severity as a capitalized label for human readers. */
export function formatUraSeverity(severity: UraSeverity): string {
  return labels[severity];
}
