import type { UraItemView } from '#contract/ipc-contract.ts';

import { anchorFromTarget } from './anchor-from-target.ts';
import { editedPatchFrom } from './edited-patch-from.ts';
import { lineFromTarget } from './line-from-target.ts';
import type { ReviewTarget } from './target-from.ts';
import { uneditableReasonFrom } from './uneditable-reason-from.ts';

/**
 * The head lines Add Suggestion edits (ADR 0043), and the staged item the suggestion attaches to, if any;
 * without one, saving opens the Add Note composer with the patch.
 */
export interface EditTarget {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly itemId?: string;
  /** That note's current suggestion, which the editor starts from. */
  readonly patch?: string;
}

/**
 * What Add Suggestion edits for `target` (ADR 0043, 0063): when its head line (as Open in Editor takes it) lies on the
 * anchor of a staged line note written against the head being shown, that note's lines, so the
 * suggestion attaches to it; otherwise the lines Add Note would stage. Nothing for a file
 * {@link uneditableReasonFrom} rules out (deleted, binary, no hunks), or when the target is a whole file or the whole change. Notes from an older head are
 * skipped: their lines number a different file.
 */
export function editTargetFrom(
  target: ReviewTarget,
  items: readonly UraItemView[],
  headSha: string,
): EditTarget | undefined {
  if (target.kind === 'change' || uneditableReasonFrom(target.file) !== undefined) {
    return undefined;
  }
  const { path } = target.file;
  const anchor = anchorFromTarget(target);
  const cursor = lineFromTarget(target);
  if (cursor === undefined || anchor.kind !== 'lines') {
    return undefined;
  }
  const item = items.find(({ status, headSha: itemHead, anchor: own, placement }) => {
    return (
      status.kind === 'staged' &&
      itemHead === headSha &&
      placement.kind === 'current' &&
      own.kind === 'lines' &&
      own.path === path &&
      own.startLine <= cursor &&
      cursor <= own.endLine
    );
  });
  if (item?.anchor.kind === 'lines') {
    const patch = editedPatchFrom(item);
    return {
      path,
      startLine: item.anchor.startLine,
      endLine: item.anchor.endLine,
      itemId: item.id,
      ...(patch !== undefined && { patch }),
    };
  }
  return { path, startLine: anchor.startLine, endLine: anchor.endLine };
}
