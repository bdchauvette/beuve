import type { UraItemView } from '#contract/ipc-contract.ts';

/** A head line of one file, on the head being shown. */
export interface LineAtHead {
  readonly path: string;
  readonly line: number;
  readonly headSha: string;
}

/**
 * The staged line note, written against `headSha` and current there, whose anchor holds `line`
 * of `path`: where Add Suggestion… puts a field when the cursor is on a note (ADR 0162). Notes
 * from an older head are skipped: their lines number a different file. Pure.
 */
export function stagedNoteAt(
  items: readonly UraItemView[],
  { path, line, headSha }: LineAtHead,
): UraItemView | undefined {
  return items.find(({ status, headSha: itemHead, anchor, placement }) => {
    return (
      status.kind === 'staged' &&
      itemHead === headSha &&
      placement.kind === 'current' &&
      anchor.kind === 'lines' &&
      anchor.path === path &&
      anchor.startLine <= line &&
      line <= anchor.endLine
    );
  });
}
