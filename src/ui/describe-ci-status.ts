import type { CiStatusView } from '#contract/ipc-contract.ts';

/** How the status bar shows a pull request's CI: a coloured dot, counts, and the failing checks. */
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
  const parts = [
    counts.failure > 0 ? `${String(counts.failure)} failing` : '',
    counts.pending > 0 ? `${String(counts.pending)} pending` : '',
    counts.success > 0 ? `${String(counts.success)} passing` : '',
    counts.neutral > 0 ? `${String(counts.neutral)} skipped` : '',
  ].filter((part) => part !== '');
  const failing = ci.checks
    .filter((check) => check.bucket === 'failure')
    .map((check) => check.name);
  const pending = ci.checks
    .filter((check) => check.bucket === 'pending')
    .map((check) => check.name);
  const title = [
    failing.length > 0 ? `Failing: ${failing.join(', ')}` : '',
    pending.length > 0 ? `Pending: ${pending.join(', ')}` : '',
    ci.isTruncated ? 'More checks exist than were fetched.' : '',
    `Head ${ci.sha.slice(0, 12)}`,
  ].filter((line) => line !== '');
  return {
    tone: tones[ci.overall],
    text: parts.length === 0 ? 'CI: no checks' : `CI ${parts.join(' · ')}`,
    title: title.join('\n'),
  };
}
