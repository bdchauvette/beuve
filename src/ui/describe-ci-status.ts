import type { CiStatusView } from '#contract/ipc-contract.ts';

/** How the status bar shows a pull request's CI: a colored dot, counts, and the failing checks. */
export interface CiStatusLine {
  readonly tone: 'ok' | 'warn' | 'danger' | 'muted';
  readonly text: string;
  readonly title: string;
}

const tones = {
  success: 'ok',
  pending: 'warn',
  failure: 'danger',
  neutral: 'muted',
  none: 'muted',
} as const;

/** `CI 1 failing · 2 pending · 3 passing`, worst first, with the failing checks as the tooltip. Pure. */
export function describeCiStatus(ci: CiStatusView): CiStatusLine {
  const { counts } = ci;
  const parts = (
    [
      [counts.failure, 'failing'],
      [counts.pending, 'pending'],
      [counts.success, 'passing'],
      [counts.neutral, 'skipped'],
    ] as const
  )
    .filter(([count]) => count > 0)
    .map(([count, word]) => `${String(count)} ${word}`);
  const failing = ci.checks
    .filter((check) => check.bucket === 'failure')
    .map((check) => check.name);
  const pending = ci.checks
    .filter((check) => check.bucket === 'pending')
    .map((check) => check.name);
  const title: string[] = [];
  if (failing.length > 0) {
    title.push(`Failing: ${failing.join(', ')}`);
  }
  if (pending.length > 0) {
    title.push(`Pending: ${pending.join(', ')}`);
  }
  if (ci.isTruncated) {
    title.push('More checks exist than were fetched.');
  }
  title.push(`Head ${ci.sha.slice(0, 12)}`);
  let text = 'CI: no checks';
  if (parts.length > 0) {
    text = `CI ${parts.join(' · ')}`;
  }
  return { tone: tones[ci.overall], text, title: title.join('\n') };
}
