import type { ChatFindingView } from '#contract/ipc-contract.ts';

/** How a diff card labels one insight. */
export interface InsightLabels {
  readonly severity: 'Risk' | 'Warning' | 'Info';
  /** "edge case", "error handling"… */
  readonly category: string;
  /** Shown only when the second pass did not confirm the finding. */
  readonly isUnconfirmed: boolean;
  /** What a screen reader hears on the collapsed note. */
  readonly summary: string;
}

const severities: Readonly<Record<ChatFindingView['severity'], InsightLabels['severity']>> = {
  risk: 'Risk',
  warning: 'Warning',
  info: 'Info',
};

/** Labels for an insight's note: its severity and category words, and whether to dim it. Pure. */
export function describeInsight(finding: ChatFindingView): InsightLabels {
  const severity = severities[finding.severity];
  const category = finding.category.replaceAll('-', ' ');
  const isUnconfirmed = finding.check === 'unconfirmed';
  const said = [`${severity} insight`, category];
  if (isUnconfirmed) {
    said.push('unconfirmed');
  }
  return { severity, category, isUnconfirmed, summary: said.join(', ') };
}
