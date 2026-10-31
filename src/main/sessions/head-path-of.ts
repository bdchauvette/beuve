import type { DiffFile } from '#internal/git/diff-model.ts';

/** The path a diff file has at the head: its new path for a rename or copy. */
export function headPathOf(file: DiffFile): string {
  if ('newPath' in file) {
    return file.newPath;
  }
  return file.path;
}
