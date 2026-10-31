import type { CiBucket, CiCheck, CiRollup } from './ci-status.ts';

/**
 * Counts per bucket and one overall state, the way GitHub's merge box reads them: any failure
 * fails, else anything pending is pending, else any success succeeds; only neutral or skipped
 * checks are neutral, and no checks at all is `none`. Pure.
 */
export function summarizeCiStatus(checks: readonly CiCheck[]): CiRollup {
  const counts: Record<CiBucket, number> = { pending: 0, success: 0, failure: 0, neutral: 0 };
  for (const check of checks) {
    counts[check.bucket] += 1;
  }
  const overall = (['failure', 'pending', 'success', 'neutral'] as const).find((bucket) => {
    return counts[bucket] > 0;
  });
  return { overall: overall ?? 'none', counts };
}
