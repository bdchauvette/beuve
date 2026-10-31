import type { DiffFile } from '#internal/git/diff-model.ts';

/** The path a renamed or copied diff file had at the base; `undefined` for any other file. */
export function oldPathOf(file: DiffFile): string | undefined {
  if ('oldPath' in file) {
    return file.oldPath;
  }
  return undefined;
}
