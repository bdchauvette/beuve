import type { FileReviewProgressView } from '#contract/ipc-contract.ts';

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
  const parts = [
    `${String(reviewed)} of ${String(total)} ${total === 1 ? 'file' : 'files'} marked reviewed`,
    changedSince === 0 ? undefined : `${String(changedSince)} changed since you marked them`,
    unreviewed === 0 ? undefined : `${String(unreviewed)} not marked`,
  ];
  return {
    text: `${String(reviewed)}/${String(total)} reviewed`,
    title: `${parts.filter((part) => part !== undefined).join(', ')}. v marks the focused file.`,
  };
}
