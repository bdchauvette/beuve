import type { DiffFileView } from '#contract/ipc-contract.ts';

/**
 * Why Add Suggestion (ADR 0162) has no lines of `file` to suggest on, or `undefined` when it has:
 * a deleted file has no head side and a binary file no text.
 */
export function unsuggestableReasonFrom(file: DiffFileView): string | undefined {
  if (file.status === 'deleted') {
    return 'A deleted file has no head lines to suggest a change on.';
  }
  if (file.binary) {
    return 'A binary file has no lines to suggest a change on.';
  }
  return undefined;
}
