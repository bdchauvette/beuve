import type { DiffFile } from './diff-model.ts';
import type { RangeCommit } from './list-range-commits.ts';

/**
 * How one commit of the previously reviewed range relates to one of the new range, in the manner
 * of `git range-diff`: `unchanged` pairs have the same patch-id, `modified` pairs were matched by
 * the similarity of their changed lines (`similarity` is the Dice coefficient, 0–1).
 */
export type CommitPairing<C extends PairableCommit = RangeCommit> =
  | { readonly kind: 'unchanged'; readonly previous: C; readonly next: C }
  | {
      readonly kind: 'modified';
      readonly previous: C;
      readonly next: C;
      readonly similarity: number;
    }
  | { readonly kind: 'added'; readonly next: C }
  | { readonly kind: 'dropped'; readonly previous: C };

export type PairableCommit = Pick<RangeCommit, 'sha' | 'subject' | 'patchId' | 'files'>;

/** A fuzzy pair needs this much changed-line overlap… */
const minimumSimilarity = 0.5;
/** …or this much when the subjects are equal (an amended commit keeps its subject). */
const minimumSimilaritySameSubject = 0.2;

/**
 * Pairs the commits of two versions of a series, both oldest first. Exact patch-id matches come
 * first (in order, so duplicated patches pair up positionally); the rest are matched greedily by
 * descending score (similarity, plus a bonus for an equal subject, then closeness of position),
 * keeping only pairs above the thresholds. The result follows the new series' order, with dropped
 * commits placed as `git range-diff` places them.
 */
export function pairCommits<C extends PairableCommit>(
  previous: readonly C[],
  next: readonly C[],
): readonly CommitPairing<C>[] {
  const partnerOfNext = new Map<number, number>();
  const partnerOfPrevious = new Map<number, number>();
  const similarityOfNext = new Map<number, number>();
  const link = (previousIndex: number, nextIndex: number): void => {
    partnerOfNext.set(nextIndex, previousIndex);
    partnerOfPrevious.set(previousIndex, nextIndex);
  };

  for (const [nextIndex, commit] of next.entries()) {
    const previousIndex = previous.findIndex((candidate, index) => {
      return !partnerOfPrevious.has(index) && isSamePatch(candidate, commit);
    });
    if (previousIndex !== -1) {
      link(previousIndex, nextIndex);
    }
  }

  const previousLines = previous.map((commit) => changedLines(commit.files));
  const nextLines = next.map((commit) => changedLines(commit.files));
  const candidates: { i: number; j: number; similarity: number; score: number }[] = [];
  for (const [i, oldCommit] of previous.entries()) {
    if (partnerOfPrevious.has(i)) {
      continue;
    }
    for (const [j, newCommit] of next.entries()) {
      if (partnerOfNext.has(j)) {
        continue;
      }
      const similarity = dice(previousLines[i] ?? new Map(), nextLines[j] ?? new Map());
      const isSameSubject = oldCommit.subject === newCommit.subject;
      const threshold = isSameSubject ? minimumSimilaritySameSubject : minimumSimilarity;
      if (similarity >= threshold) {
        candidates.push({ i, j, similarity, score: similarity + (isSameSubject ? 0.3 : 0) });
      }
    }
  }
  const distance = (candidate: { i: number; j: number }): number => {
    return Math.abs(
      candidate.i / Math.max(previous.length, 1) - candidate.j / Math.max(next.length, 1),
    );
  };
  candidates.sort((a, b) => {
    return b.score - a.score || distance(a) - distance(b) || a.j - b.j || a.i - b.i;
  });
  for (const candidate of candidates) {
    if (partnerOfPrevious.has(candidate.i) || partnerOfNext.has(candidate.j)) {
      continue;
    }

    link(candidate.i, candidate.j);
    similarityOfNext.set(candidate.j, candidate.similarity);
  }

  return orderPairings(previous, next, partnerOfNext, similarityOfNext);
}

function isSamePatch(previous: PairableCommit, next: PairableCommit): boolean {
  if (previous.sha === next.sha) {
    return true;
  }
  return previous.patchId === undefined
    ? next.patchId === undefined && previous.subject === next.subject
    : previous.patchId === next.patchId;
}

/** Changed lines as a multiset of `path`, sign and whitespace-trimmed content. */
function changedLines(files: readonly DiffFile[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const file of files) {
    const path = 'newPath' in file ? file.newPath : file.path;
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.kind === 'context') {
          continue;
        }

        const key = `${path}\0${line.kind === 'added' ? '+' : '-'}${line.content.trim()}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return counts;
}

function dice(left: ReadonlyMap<string, number>, right: ReadonlyMap<string, number>): number {
  let leftSize = 0;
  let rightSize = 0;
  let shared = 0;
  for (const [key, count] of left) {
    leftSize += count;
    shared += Math.min(count, right.get(key) ?? 0);
  }
  for (const count of right.values()) {
    rightSize += count;
  }
  return leftSize + rightSize === 0 ? 0 : (2 * shared) / (leftSize + rightSize);
}

/** `git range-diff`'s output order: a dropped commit shows as soon as its predecessors have. */
function orderPairings<C extends PairableCommit>(
  previous: readonly C[],
  next: readonly C[],
  partnerOfNext: ReadonlyMap<number, number>,
  similarityOfNext: ReadonlyMap<number, number>,
): readonly CommitPairing<C>[] {
  const pairings: CommitPairing<C>[] = [];
  const paired = new Set(partnerOfNext.values());
  const shown = new Set<number>();
  let i = 0;
  let j = 0;
  while (i < previous.length || j < next.length) {
    const old = previous[i];
    if (old !== undefined && shown.has(i)) {
      i += 1;
      continue;
    }
    if (old !== undefined && !paired.has(i)) {
      pairings.push({ kind: 'dropped', previous: old });
      i += 1;
      continue;
    }
    for (let commit = next[j]; commit !== undefined && !partnerOfNext.has(j); commit = next[j]) {
      pairings.push({ kind: 'added', next: commit });
      j += 1;
    }
    const commit = next[j];
    const partner = partnerOfNext.get(j);
    const partnerCommit = partner === undefined ? undefined : previous[partner];
    if (commit === undefined || partner === undefined || partnerCommit === undefined) {
      continue;
    }
    const similarity = similarityOfNext.get(j);
    pairings.push(
      similarity === undefined
        ? { kind: 'unchanged', previous: partnerCommit, next: commit }
        : { kind: 'modified', previous: partnerCommit, next: commit, similarity },
    );
    shown.add(partner);
    j += 1;
  }
  return pairings;
}
