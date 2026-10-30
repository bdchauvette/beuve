import type { MentionTarget } from './chat-draft.ts';
import type { ReviewTarget } from './target-from.ts';

/**
 * What Add to Chat adds to the chat from `target` (ADR 0046, 0063): a selection on its own side (base
 * lines under the base path), a hunk's head lines (a pure deletion: its base lines), a jump's
 * line, or the whole file (the base side of a deleted file). Nothing for the whole change. Pure.
 */
export function mentionFromTarget(target: ReviewTarget): MentionTarget | undefined {
  if (target.kind === 'change') {
    return undefined;
  }
  const { file } = target;
  const head = (start: number, end: number): MentionTarget => ({
    path: file.path,
    side: 'head',
    startLine: start,
    endLine: end,
  });
  const base = (start: number, end: number): MentionTarget => ({
    path: file.oldPath ?? file.path,
    side: 'base',
    startLine: start,
    endLine: end,
  });
  switch (target.kind) {
    case 'selection': {
      return target.side === 'base'
        ? base(target.start, target.end)
        : head(target.start, target.end);
    }
    case 'hunk': {
      if (target.head !== undefined) {
        return head(target.head.start, target.head.end);
      }
      return target.base === undefined
        ? head(target.line, target.line)
        : base(target.base.start, target.base.end);
    }
    case 'line': {
      return head(target.line, target.line);
    }
    case 'file': {
      return file.status === 'deleted'
        ? { path: file.oldPath ?? file.path, side: 'base' }
        : { path: file.path, side: 'head' };
    }
  }
}
