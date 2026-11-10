import type { VerdictClearReason } from '#internal/ura/ura-verdict-choice.ts';

const notices: Readonly<Record<VerdictClearReason, string>> = {
  'blocking-staged':
    'Your Approve verdict was cleared because a blocking note is staged. The derived verdict applies.',
  'head-moved': 'Verdict cleared: new commits since you chose it',
};

/** The sentence the dock shows when a stored verdict choice was dropped. */
export function verdictNoticeFrom(reason: VerdictClearReason): string {
  return notices[reason];
}
