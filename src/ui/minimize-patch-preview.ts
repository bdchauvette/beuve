import type { PatchLine } from './split-patch.ts';

/**
 * Shrinks a suggested patch's lines to what a reviewer needs to read (ADR 0043). The stored patch
 * removes every anchored line and adds what replaced it, so that GitHub can post it as a
 * suggestion; lines the edit left alone show up as a removal and an identical addition. Here each
 * removed/added run is diffed against itself, matching lines turn back into context, and only
 * `contextLines` unchanged lines stay around a change, with an ellipsis note for what is hidden.
 * Display only: the patch itself is not touched. Hunk and header lines are expected to be gone.
 */
export function minimizePatchPreview(lines: readonly PatchLine[], contextLines = 2): PatchLine[] {
  const merged = matchRuns(lines);
  const changes: number[] = [];
  for (const [index, line] of merged.entries()) {
    if (line.kind === 'added' || line.kind === 'removed') {
      changes.push(index);
    }
  }
  const result: PatchLine[] = [];
  let isGap = false;
  for (const [index, line] of merged.entries()) {
    const isKept =
      changes.length === 0 ||
      line.kind !== 'context' ||
      changes.some((change) => Math.abs(change - index) <= contextLines);
    if (!isKept) {
      isGap = true;
      continue;
    }
    if (isGap && result.length > 0) {
      result.push({ kind: 'note', text: '⋯' });
    }
    isGap = false;
    result.push(line);
  }
  return result;
}

function matchRuns(lines: readonly PatchLine[]): PatchLine[] {
  const result: PatchLine[] = [];
  let index = 0;
  while (index < lines.length) {
    const first = lines[index];
    if (first?.kind !== 'removed' && first?.kind !== 'added') {
      if (first !== undefined) {
        result.push(first);
      }
      index += 1;
      continue;
    }
    const removed: string[] = [];
    const added: string[] = [];
    let isPlain = true;
    while (index < lines.length && lines[index]?.kind !== 'context') {
      const line = lines[index];
      if (line?.kind === 'removed') {
        removed.push(line.text.slice(1));
      } else if (line?.kind === 'added') {
        added.push(line.text.slice(1));
      } else {
        isPlain = false;
      }
      index += 1;
    }
    result.push(...(isPlain ? diffRun(removed, added) : rebuildRun(lines, index)));
  }
  return result;
}

/** A run with "no newline" notes keeps its lines as they are: the markers belong to exact lines. */
function rebuildRun(lines: readonly PatchLine[], end: number): PatchLine[] {
  let start = end;
  while (start > 0 && lines[start - 1]?.kind !== 'context') {
    start -= 1;
  }
  return lines.slice(start, end);
}

function diffRun(removed: readonly string[], added: readonly string[]): PatchLine[] {
  const common = longestCommonSubsequence(removed, added);
  const result: PatchLine[] = [];
  let from = 0;
  let to = 0;
  for (const [fromMatch, toMatch] of common) {
    for (; from < fromMatch; from += 1) {
      result.push({ kind: 'removed', text: `-${removed[from] ?? ''}` });
    }
    for (; to < toMatch; to += 1) {
      result.push({ kind: 'added', text: `+${added[to] ?? ''}` });
    }
    result.push({ kind: 'context', text: ` ${removed[from] ?? ''}` });
    from += 1;
    to += 1;
  }
  for (; from < removed.length; from += 1) {
    result.push({ kind: 'removed', text: `-${removed[from] ?? ''}` });
  }
  for (; to < added.length; to += 1) {
    result.push({ kind: 'added', text: `+${added[to] ?? ''}` });
  }
  return result;
}

/** Index pairs of a longest common subsequence; quadratic, fine for the few lines a note spans. */
function longestCommonSubsequence(
  a: readonly string[],
  b: readonly string[],
): (readonly [number, number])[] {
  const table = [...a, ''].map(() => [...b.map(() => 0), 0]);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      const row = table[i];
      if (row === undefined) {
        continue;
      }
      row[j] =
        a[i] === b[j]
          ? (table[i + 1]?.[j + 1] ?? 0) + 1
          : Math.max(table[i + 1]?.[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const pairs: (readonly [number, number])[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return pairs;
}
