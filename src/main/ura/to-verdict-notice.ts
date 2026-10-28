import type { VerdictClearReason } from '#internal/ura/ura-verdict-choice.ts';

const notices: Readonly<Record<VerdictClearReason, string>> = {
  'blocker-staged':
    'Your Approve verdict was cleared because a blocker is staged. The derived verdict applies.',
};

/** The sentence the dock shows when a stored verdict choice was dropped. */
export function toVerdictNotice(reason: VerdictClearReason): string {
  return notices[reason];
}
