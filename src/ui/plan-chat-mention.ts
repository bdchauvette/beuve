import type { DiffFileView, DiffHunkView } from '#contract/ipc-contract.ts';

import type { MentionTarget } from './chat-draft.ts';
import type { SelectedLines } from './plan-stage-anchor.ts';

/**
 * What "Add selection to chat" takes from a diff card (ADR 0046): the line selection, on the
 * base side when both its ends are there (a split view's left column, or deleted rows inline),
 * else on the head side; without one, the focused hunk's head lines (a pure deletion: its base
 * lines); without a focused hunk, the whole file (the base side of a deleted file). Pure.
 */
export function planChatMention(
  file: DiffFileView,
  hunk: DiffHunkView | undefined,
  selection: SelectedLines | undefined,
): MentionTarget {
  const headPath = file.path;
  const basePath = file.oldPath ?? file.path;
  if (selection !== undefined) {
    const startLine = Math.max(1, Math.min(selection.start, selection.end));
    const endLine = Math.max(startLine, selection.start, selection.end);
    const isBase =
      (selection.side ?? 'additions') === 'deletions' &&
      (selection.endSide ?? selection.side) === 'deletions';
    return isBase
      ? { path: basePath, side: 'base', startLine, endLine }
      : { path: headPath, side: 'head', startLine, endLine };
  }
  if (hunk === undefined) {
    return file.status === 'deleted'
      ? { path: basePath, side: 'base' }
      : { path: headPath, side: 'head' };
  }
  if (hunk.newCount === 0) {
    const startLine = Math.max(1, hunk.oldStart);
    return {
      path: basePath,
      side: 'base',
      startLine,
      endLine: startLine + Math.max(1, hunk.oldCount) - 1,
    };
  }
  return {
    path: headPath,
    side: 'head',
    startLine: hunk.newStart,
    endLine: hunk.newStart + hunk.newCount - 1,
  };
}
