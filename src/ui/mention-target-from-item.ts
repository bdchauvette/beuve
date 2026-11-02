import type { DiffFileView, UraItemView } from '#contract/ipc-contract.ts';

import type { MentionTarget } from './chat-draft.ts';
import { mentionFromTarget } from './mention-from-target.ts';
import { targetFromAnchor } from './target-from-anchor.ts';

/**
 * What a staged note puts in the chat as a chip (ADR 0046, 0063): its lines at this head, or its
 * file, through the diff's own adapter; or a sentence saying why it cannot. Pure.
 */
export function mentionTargetFromItem(
  item: UraItemView,
  files: readonly DiffFileView[],
): MentionTarget | string {
  if (item.placement.kind !== 'current') {
    return 'That note is outdated: its lines are not at this head.';
  }
  const target = targetFromAnchor(item.placement.anchor, files);
  if (target === undefined) {
    return 'That note’s file is not in this diff.';
  }
  return mentionFromTarget(target) ?? 'That note is on the whole change; pick a line or file note.';
}
