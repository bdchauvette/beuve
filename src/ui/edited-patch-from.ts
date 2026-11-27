import type { UraItemView } from '#contract/ipc-contract.ts';

/**
 * The patch Add Suggestion re-edits a note from (ADR 0043): its one suggestion's, when that is on
 * the note's own path; `undefined` otherwise, and the editor starts from the head.
 */
export function editedPatchFrom(item: UraItemView): string | undefined {
  const [only, ...others] = item.suggestions;
  if (
    only === undefined ||
    others.length > 0 ||
    item.anchor.kind === 'change' ||
    only.path !== item.anchor.path
  ) {
    return undefined;
  }
  return only.patch;
}
