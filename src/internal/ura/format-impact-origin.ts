import { formatOrdinal } from './format-ordinal.ts';
import type { UraOrigin } from './ura-item.ts';

/** One Markdown sentence with an ImpactGate finding's numbers. */
export function formatImpactOrigin(origin: Extract<UraOrigin, { kind: 'impact-finding' }>): string {
  const percentile = formatOrdinal(Math.round(origin.percentile));
  const metric = origin.metric.replaceAll('-', ' ');
  return `ImpactGate: ${metric} ${String(origin.value)} in \`${origin.functionName}\` (limit ${String(origin.threshold)}, ${percentile} percentile).`;
}
