/**
 * Where Next/Previous Change are in the diff stream: a file, and a hunk of it, or `-1` for the file's header
 * (where a click or a tree selection lands).
 */
export interface ReviewPosition {
  readonly file: number;
  readonly hunk: number;
}

/**
 * One Next Change (`step` 1) or Previous Change (-1) through every hunk of every file in stream order, given each
 * file's hunk count. A file without hunks (a binary or pure rename) is one stop at its header.
 * Stops at either end; an out-of-range position is clamped first.
 */
export function stepReviewPosition(
  hunkCounts: readonly number[],
  position: ReviewPosition,
  step: 1 | -1,
): ReviewPosition {
  if (hunkCounts.length === 0) {
    return { file: 0, hunk: -1 };
  }
  const lastStop = (file: number): number => Math.max(0, (hunkCounts[file] ?? 0) - 1);
  const firstStop = (file: number): number => ((hunkCounts[file] ?? 0) === 0 ? -1 : 0);
  const file = Math.min(hunkCounts.length - 1, Math.max(0, position.file));
  const hunk = Math.min(lastStop(file), Math.max(-1, position.hunk));
  if (step === 1) {
    if (hunk < (hunkCounts[file] ?? 0) - 1) {
      return { file, hunk: hunk + 1 };
    }
    return file === hunkCounts.length - 1
      ? { file, hunk }
      : { file: file + 1, hunk: firstStop(file + 1) };
  }
  if (hunk > 0) {
    return { file, hunk: hunk - 1 };
  }
  return file === 0
    ? { file, hunk: firstStop(file) }
    : { file: file - 1, hunk: (hunkCounts[file - 1] ?? 0) === 0 ? -1 : lastStop(file - 1) };
}
