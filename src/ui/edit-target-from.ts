import type { UraItemView } from '#contract/ipc-contract.ts';

import { anchorFromTarget } from './anchor-from-target.ts';
import { lineFromTarget } from './line-from-target.ts';
import type { ReviewTarget } from './target-from.ts';

/**
 * The head lines `e` edits (ADR 0043), and the staged item the suggestion attaches to, if any;
 * without one, saving opens the `m` composer with the patch.
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
 * What `e` edits for `target` (ADR 0043, 0063): when its head line (as `o` takes it) lies on the
 * anchor of a staged line note written against the head being shown, that note's lines, so the
 * suggestion attaches to it; otherwise the lines `m` would stage. Nothing for a deleted or binary
 * file, or when the target is a whole file or the whole change. Notes from an older head are
 * skipped: their lines number a different file.
 */
export function editTargetFrom(
  target: ReviewTarget,
  items: readonly UraItemView[],
  headSha: string,
): EditTarget | undefined {
  if (target.kind === 'change' || target.file.status === 'deleted' || target.file.binary) {
    return undefined;
  }
  const { path } = target.file;
  const anchor = anchorFromTarget(target);
  const cursor = lineFromTarget(target);
  if (cursor === undefined || anchor.kind !== 'lines') {
    return undefined;
  }
  const item = items.find(
    ({ status, headSha: itemHead, anchor: own, placement }) =>
      status.kind === 'staged' &&
      itemHead === headSha &&
      placement.kind === 'current' &&
      own.kind === 'lines' &&
      own.path === path &&
      own.startLine <= cursor &&
      cursor <= own.endLine,
  );
  return item?.anchor.kind === 'lines'
    ? {
        path,
        startLine: item.anchor.startLine,
        endLine: item.anchor.endLine,
        itemId: item.id,
        ...(item.suggestedPatch !== undefined && { patch: item.suggestedPatch }),
      }
    : { path, startLine: anchor.startLine, endLine: anchor.endLine };
}
