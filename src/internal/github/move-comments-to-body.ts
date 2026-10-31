import { revealFormatControls } from '#x/text/reveal-format-controls.ts';

import type { ReviewComment, ReviewPayload } from './review-payload.ts';

/**
 * `payload` with the comments `shouldMove` picks (all of them by default) taken out of `comments`
 * and appended to the body under their `path:line` (or `path:start–end`), in their original
 * order, so a review GitHub refused to anchor can still be posted whole. Pure.
 */
export function moveCommentsToBody(
  payload: ReviewPayload,
  shouldMove: (comment: ReviewComment, index: number) => boolean = (): boolean => true,
): ReviewPayload {
  const kept: ReviewComment[] = [];
  const moved: string[] = [];
  for (const [index, comment] of payload.comments.entries()) {
    if (shouldMove(comment, index)) {
      moved.push(
        `**\`${revealFormatControls(comment.path)}\`, ${formatLines(comment)}**\n\n${comment.body}`,
      );
    } else {
      kept.push(comment);
    }
  }
  if (moved.length === 0) {
    return payload;
  }
  const section = ['### Comments GitHub could not attach to the diff', ...moved].join('\n\n');
  return {
    ...payload,
    body: payload.body.trim() === '' ? section : `${payload.body}\n\n${section}`,
    comments: kept,
  };
}

function formatLines(comment: ReviewComment): string {
  return comment.start_line === undefined || comment.start_line === comment.line
    ? `line ${String(comment.line)}`
    : `lines ${String(comment.start_line)}–${String(comment.line)}`;
}
