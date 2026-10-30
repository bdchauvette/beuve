import type { DiffFile, DiffHunk } from './diff-model.ts';
import type { RangeCommit } from './list-range-commits.ts';
import type { CommitSha } from './object-id.ts';

/** Which commits of a range touched a file of a head-side diff, overall and per hunk. */
export interface FileAttribution {
  /** Commits that changed this path (followed through renames), oldest first. */
  readonly commits: readonly CommitSha[];
  /** Aligned with the file's hunks: commits whose changed lines meet the hunk's changed lines. */
  readonly hunks: readonly (readonly CommitSha[])[];
}

/**
 * Attributes each hunk of `files` (any diff whose new side is the head of `commits`, such as an
 * interdiff) to the commits of the range that produced those lines. Pure: every commit's changed
 * lines are carried forward to head coordinates through the zero-context diffs of the commits
 * after it (renames followed; lines a later commit rewrote belong to that commit), then matched
 * against the hunk's added lines and deletion points, a deletion point also meeting its
 * neighbouring lines. Lines the range didn't produce (e.g. a change the author reverted) are
 * attributed to nobody.
 */
export function attributeHunks(
  files: readonly DiffFile[],
  commits: readonly RangeCommit[],
): readonly FileAttribution[] {
  const touches = commits.map((): Map<string, Set<number>> => new Map());
  const touchedPaths = commits.map((): Set<string> => new Set());
  for (const [index, commit] of commits.entries()) {
    for (let earlier = 0; earlier < index; earlier += 1) {
      touches[earlier] = carryForward(touches[earlier] ?? new Map(), commit.files);
      touchedPaths[earlier] = renamePaths(touchedPaths[earlier] ?? new Set(), commit.files);
    }
    const own = touches[index] ?? new Map<string, Set<number>>();
    for (const file of commit.files) {
      const path = newSidePath(file);
      touchedPaths[index]?.add(path);
      const keys = own.get(path) ?? new Set<number>();
      for (const hunk of file.hunks) {
        for (const key of hunkKeys(hunk)) {
          keys.add(key);
        }
      }
      own.set(path, keys);
    }
    touches[index] = own;
  }

  return files.map((file) => {
    const path = newSidePath(file);
    const touching = commits.filter((_, index) => touchedPaths[index]?.has(path) === true);
    return {
      commits: touching.map((commit) => commit.sha),
      hunks: file.hunks.map((hunk) => {
        const keys = hunkKeys(hunk);
        return commits
          .filter((_, index) => {
            const own = touches[index]?.get(path);
            return own !== undefined && keys.some((key) => isMeeting(own, key));
          })
          .map((commit) => commit.sha);
      }),
    };
  });
}

/** The path a file has after the change (the old path for a deletion). */
function newSidePath(file: DiffFile): string {
  return 'newPath' in file ? file.newPath : file.path;
}

function carryForward(
  touches: ReadonlyMap<string, ReadonlySet<number>>,
  files: readonly DiffFile[],
): Map<string, Set<number>> {
  const carried = new Map<string, Set<number>>();
  for (const [path, keys] of touches) {
    const file = files.find((candidate) => oldSidePath(candidate) === path);
    if (file === undefined) {
      merge(carried, path, keys);
      continue;
    }
    if (file.status === 'deleted') {
      continue;
    }
    const mapped = new Set<number>();
    for (const key of keys) {
      const moved = mapKey(key, file.hunks);
      if (moved !== undefined) {
        mapped.add(moved);
      }
    }
    merge(carried, newSidePath(file), mapped);
  }
  return carried;
}

function renamePaths(paths: ReadonlySet<string>, files: readonly DiffFile[]): Set<string> {
  const renamed = new Set<string>();
  for (const path of paths) {
    const file = files.find((candidate) => oldSidePath(candidate) === path);
    renamed.add(file === undefined || file.status === 'deleted' ? path : newSidePath(file));
  }
  return renamed;
}

/** Copies leave their source in place, so only renames move a path. */
function oldSidePath(file: DiffFile): string | undefined {
  if ('oldPath' in file) {
    return file.status === 'renamed' ? file.oldPath : undefined;
  }
  return file.status === 'added' ? undefined : file.path;
}

function merge(target: Map<string, Set<number>>, path: string, keys: Iterable<number>): void {
  const existing = target.get(path) ?? new Set<number>();
  for (const key of keys) {
    existing.add(key);
  }
  target.set(path, existing);
}

/**
 * A hunk's changed positions on its new side: line `n` is `2n`, a deletion point after line `n`
 * is `2n + 1`. Context lines only move the cursor; a removal replaced by added lines is just those
 * lines, so a later rewrite of them leaves nothing of the earlier commit behind.
 */
function hunkKeys(hunk: DiffHunk): number[] {
  const keys: number[] = [];
  let cursor = hunk.newCount === 0 ? hunk.newStart : hunk.newStart - 1;
  let pendingPoint: number | undefined;
  for (const line of hunk.lines) {
    if (line.kind === 'removed') {
      pendingPoint = 2 * cursor + 1;
      continue;
    }
    if (pendingPoint !== undefined && line.kind === 'context') {
      keys.push(pendingPoint);
    }
    pendingPoint = undefined;
    cursor = line.newLine;
    if (line.kind === 'added') {
      keys.push(2 * cursor);
    }
  }
  if (pendingPoint !== undefined) {
    keys.push(pendingPoint);
  }
  return keys;
}

/**
 * Moves a key from a later commit's old side to its new side, through that commit's zero-context
 * hunks; `undefined` when the commit removed the line.
 */
function mapKey(key: number, hunks: readonly DiffHunk[]): number | undefined {
  const isPoint = key % 2 === 1;
  const line = (isPoint ? key - 1 : key) / 2;
  if (isPoint && line === 0) {
    return key;
  }
  let delta = 0;
  for (const hunk of hunks) {
    if (hunk.oldCount === 0) {
      if (line <= hunk.oldStart) {
        break;
      }
      delta += hunk.newCount;
      continue;
    }
    if (line < hunk.oldStart) {
      break;
    }
    if (line < hunk.oldStart + hunk.oldCount) {
      return undefined;
    }
    delta += hunk.newCount - hunk.oldCount;
  }
  return isPoint ? 2 * (line + delta) + 1 : 2 * (line + delta);
}

function isMeeting(keys: ReadonlySet<number>, key: number): boolean {
  return keys.has(key) || keys.has(key - 1) || keys.has(key + 1);
}
