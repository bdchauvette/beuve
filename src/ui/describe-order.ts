import type { ReviewOrderMode } from '#contract/ipc-contract.ts';

const orderDescriptions: Readonly<Record<ReviewOrderMode, string>> = {
  path: 'Files in path order',
  imports: 'Files by imports: what a file uses comes before it',
  calls: 'Files by calls: what a function calls comes before it',
};

/** How the files are ordered, for the notice after `/order`. */
export function describeOrder(mode: ReviewOrderMode = 'path'): string {
  return orderDescriptions[mode];
}
