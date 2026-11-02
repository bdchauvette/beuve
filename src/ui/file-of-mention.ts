import type { ChatMentionView, DiffFileView } from '#contract/ipc-contract.ts';

/**
 * The file a chat chip points into: by its base path for a base-side chip (not for an added
 * file), by its head path otherwise (not for a deleted one); `undefined` when the review does
 * not change that file. Pure.
 */
export function fileOfMention(
  mention: ChatMentionView,
  files: readonly DiffFileView[],
): DiffFileView | undefined {
  return files.find((candidate) => {
    if (mention.side === 'base') {
      return (candidate.oldPath ?? candidate.path) === mention.path && candidate.status !== 'added';
    }
    return candidate.path === mention.path && candidate.status !== 'deleted';
  });
}
