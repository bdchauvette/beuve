import type { CiStatusView } from '#contract/ipc-contract.ts';
import type { CiStatus } from '#internal/github/ci-status.ts';

/** The github domain's CI status as plain contract data: failures first, then pending. */
export function ciStatusViewFrom(status: CiStatus): CiStatusView {
  const order = { failure: 0, pending: 1, neutral: 2, success: 3 } as const;
  return {
    sha: status.sha,
    overall: status.rollup.overall,
    counts: { ...status.rollup.counts },
    checks: status.checks
      .map((check) => ({
        name: check.name,
        bucket: check.bucket,
        ...(check.url !== undefined && { url: check.url }),
      }))
      .toSorted((left, right) => order[left.bucket] - order[right.bucket]),
    isTruncated: status.isTruncated,
  };
}
