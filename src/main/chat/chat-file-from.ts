import type { ChatFile } from '#internal/chat/chat-question.ts';
import type { DiffFile } from '#internal/git/diff-model.ts';

/** A git-domain diff file as the chat domain's prompts take it: head path, status, patch. */
export function chatFileFrom(file: DiffFile): ChatFile {
  const common = { binary: file.binary, patch: file.patch };
  switch (file.status) {
    case 'added':
    case 'deleted':
    case 'modified': {
      return { path: file.path, status: file.status, ...common };
    }
    case 'renamed':
    case 'copied': {
      return { path: file.newPath, previousPath: file.oldPath, status: file.status, ...common };
    }
  }
}
