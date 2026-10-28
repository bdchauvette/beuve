import type { UraVerdict } from './ura-artifact.ts';
import type { UraSeverity } from './ura-severities.ts';

/**
 * The verdict staged items imply: any `blocker` requests changes; any `issue` or `question`
 * leaves a comment, since the author has to act or answer; `nit`s and `praise` (or nothing at
 * all) approve, because nits are optional by definition.
 */
export function deriveUraVerdict(severities: readonly UraSeverity[]): UraVerdict {
  if (severities.includes('blocker')) {
    return 'request-changes';
  }
  return severities.some((severity) => severity === 'issue' || severity === 'question')
    ? 'comment'
    : 'approve';
}
