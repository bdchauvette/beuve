import type { FileReviewProgressView } from '#contract/ipc-contract.ts';

import { countNoun } from './count-noun.ts';

/** The review header's progress, e.g. `12/30 reviewed`, with the details on hover. */
export interface ReviewProgressLine {
  readonly text: string;
  readonly title: string;
}

/**
 * Describes how many of the shown files are marked reviewed (ADR 0064); `undefined` without
 * files. Files changed since their mark count as not reviewed and are named in the title. Pure.
 */
export function describeReviewProgress(
  progress: FileReviewProgressView | undefined,
): ReviewProgressLine | undefined {
  if (progress === undefined || progress.total === 0) {
    return undefined;
  }
  const { total, reviewed, changedSince, unreviewed } = progress;
  const parts = [`${String(reviewed)} of ${countNoun(total, 'file')} marked reviewed`];
  if (changedSince !== 0) {
    parts.push(`${String(changedSince)} changed since you marked them`);
  }
  if (unreviewed !== 0) {
    parts.push(`${String(unreviewed)} not marked`);
  }
  return {
    text: `${String(reviewed)}/${String(total)} reviewed`,
    title: `${parts.join(', ')}. v marks the focused file.`,
  };
}
