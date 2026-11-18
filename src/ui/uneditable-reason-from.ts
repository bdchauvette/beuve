import type { DiffFileView } from '#contract/ipc-contract.ts';

/**
 * Why Suggest Edit (ADR 0043) cannot edit `file`, or `undefined` when it can: a deleted file has
 * no head side, a binary file no text, and a file with no hunks (a pure rename or mode change,
 * an empty new file) no changed lines to pick.
 */
export function uneditableReasonFrom(file: DiffFileView): string | undefined {
  if (file.status === 'deleted') {
    return 'A deleted file has no head lines to suggest an edit on.';
  }
  if (file.binary) {
    return 'A binary file cannot be edited as text.';
  }
  if (file.hunks.length === 0) {
    return 'This file has no changed lines to suggest an edit on.';
  }
  return undefined;
}
