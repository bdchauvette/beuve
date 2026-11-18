import type { ReviewThreadView } from '#contract/ipc-contract.ts';

/** `line 3`, `lines 3–4`, `base line 3` or `whole file`, with `(outdated)` once the code changed. */
export function describeThreadPlace(thread: ReviewThreadView): string {
  const { startLine, endLine } = thread;
  let place = 'whole file';
  if (startLine !== undefined && endLine !== undefined) {
    place = `line ${String(endLine)}`;
    if (startLine !== endLine) {
      place = `lines ${String(startLine)}–${String(endLine)}`;
    }
    if (thread.side === 'base') {
      place = `base ${place}`;
    }
  }
  if (thread.isOutdated) {
    return `${place} (outdated)`;
  }
  return place;
}
