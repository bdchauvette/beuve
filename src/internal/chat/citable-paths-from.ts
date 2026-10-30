import type { ChatFile } from './chat-question.ts';

/** What an answer may cite (ADR 0031): the diff's non-deleted head paths and the head's files. */
export function citablePathsFrom(
  files: readonly ChatFile[],
  worktreePaths: ReadonlySet<string> | undefined,
): Set<string> {
  const paths = new Set(worktreePaths);
  for (const file of files) {
    if (file.status !== 'deleted') {
      paths.add(file.path);
    }
  }
  return paths;
}
