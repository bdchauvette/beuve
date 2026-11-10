import type { UraEntry } from './ura-artifact.ts';
import { uraSeverities } from './ura-severities.ts';
import type { UraSeverity } from './ura-severities.ts';

/** Entries per label, every label present in label order, then how many are blocking. */
export type UraCounts = Record<UraSeverity | 'blocking', number>;

/** How many entries there are of each label, and how many of them are blocking (ADR 0131). */
export function countUraSeverities(entries: readonly UraEntry[]): UraCounts {
  const counts = Object.fromEntries(
    [...uraSeverities, 'blocking'].map((key) => {
      return [key, 0];
    }),
  ) as UraCounts;
  for (const { item } of entries) {
    counts[item.severity] += 1;
    if (item.blocking) {
      counts.blocking += 1;
    }
  }
  return counts;
}
