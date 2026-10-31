import type { FileReviewState } from './session.ts';

/** A file of the diff now shown, with the identity of its diff (see `fileDiffIdFrom` in the git domain). */
export interface MarkableFile {
  readonly path: string;
  /** Set for a renamed or copied file: the path the other side had. */
  readonly oldPath?: string | undefined;
  readonly diffId: string;
}

/** The part of a stored mark carry-over needs. */
export interface MarkedFile {
  readonly path: string;
  readonly diffId: string;
}

export interface FileReviewCounts {
  /** Files in the diff now shown. */
  readonly total: number;
  readonly reviewed: number;
  readonly changedSince: number;
  readonly unreviewed: number;
}

export interface CarriedMarks {
  /** Aligned with the input files. */
  readonly states: readonly FileReviewState[];
  readonly counts: FileReviewCounts;
  /** Marked paths that no file of the diff now shown claims (the file was removed or left the diff). */
  readonly orphanedPaths: readonly string[];
}

/**
 * Decides, for every file of the diff now shown, whether its mark still holds (ADR 0064). A mark
 * belongs to a file by its path, else by its other-side path (a rename), else by an identical diff
 * under a marked path that left the diff (a move git did not pair); it carries over (`yes`)
 * only when the file's diff identity is the one that was reviewed, whichever commits produced it,
 * and otherwise reads `changed-since`. A file without a mark is `no`. Marks of files that left
 * the diff are reported as orphaned and are never dropped. A mark serves one file. Pure.
 */
export function carryOverFileMarks(
  marks: readonly MarkedFile[],
  files: readonly MarkableFile[],
): CarriedMarks {
  const unclaimed = new Map(
    marks.map((mark) => {
      return [mark.path, mark];
    }),
  );
  const claims: (MarkedFile | undefined)[] = files.map((file) => claim(unclaimed, file.path));
  for (const [index, file] of files.entries()) {
    if (file.oldPath !== undefined) {
      claims[index] ??= claim(unclaimed, file.oldPath);
    }
  }
  for (const [index, file] of files.entries()) {
    claims[index] ??= claimByDiff(marks, unclaimed, file.diffId);
  }
  const states = files.map((file, index): FileReviewState => {
    const mark = claims[index];
    if (mark === undefined) {
      return 'no';
    }
    return mark.diffId === file.diffId ? 'yes' : 'changed-since';
  });
  const countOf = (state: FileReviewState): number => {
    return states.filter((candidate) => candidate === state).length;
  };
  return {
    states,
    counts: {
      total: files.length,
      reviewed: countOf('yes'),
      changedSince: countOf('changed-since'),
      unreviewed: countOf('no'),
    },
    orphanedPaths: marks.filter((mark) => unclaimed.has(mark.path)).map((mark) => mark.path),
  };
}

/** A file moved without git noticing (a removal plus an addition of the same change). */
function claimByDiff(
  marks: readonly MarkedFile[],
  unclaimed: Map<string, MarkedFile>,
  diffId: string,
): MarkedFile | undefined {
  const found = marks.find((mark) => unclaimed.has(mark.path) && mark.diffId === diffId);
  return found === undefined ? undefined : claim(unclaimed, found.path);
}

function claim(unclaimed: Map<string, MarkedFile>, path: string): MarkedFile | undefined {
  const mark = unclaimed.get(path);
  unclaimed.delete(path);
  return mark;
}
