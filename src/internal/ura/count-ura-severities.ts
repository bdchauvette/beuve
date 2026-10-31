import type { UraEntry } from './ura-artifact.ts';
import { uraSeverities } from './ura-severities.ts';
import type { UraSeverity } from './ura-severities.ts';

/** How many entries there are of each severity, every severity present, in severity order. */
export function countUraSeverities(entries: readonly UraEntry[]): Record<UraSeverity, number> {
  const counts = Object.fromEntries(
    uraSeverities.map((severity) => {
      return [severity, 0];
    }),
  ) as Record<UraSeverity, number>;
  for (const { item } of entries) {
    counts[item.severity] += 1;
  }
  return counts;
}
