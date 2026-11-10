import type { UraSeverityView } from '#contract/ipc-contract.ts';
import { uraSeverities } from '#internal/ura/ura-severities.ts';

/**
 * A proposed note's stored label as a current note label (ADR 0132), or `undefined` when the
 * labels changed since the answer proposed it. The chat domain stores labels as text; the URA's
 * severities are the list main offered the model.
 */
export function noteLabelFrom(label: string): UraSeverityView | undefined {
  return labels.find((known) => known === label);
}

const labels: readonly UraSeverityView[] = uraSeverities;
