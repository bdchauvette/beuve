import type { LineMappingHunk } from './line-mapping.ts';

/**
 * A run of changed lines on the old side: `removed` lines after old line `before` (so lines
 * `before + 1` to `before + removed`) were replaced by `added` lines. A pure insertion has
 * `removed: 0` and sits between old lines `before` and `before + 1`.
 */
export interface ChangeRegion {
  readonly before: number;
  readonly removed: number;
  readonly added: number;
}

/**
 * The changed runs of a hunk, in order. Context lines split runs. Without `lines`, the whole hunk
 * is one run, following unified diff's convention that `-a,0` means "after line a".
 */
export function changeRegionsFrom(hunk: LineMappingHunk): ChangeRegion[] {
  if (hunk.lines === undefined) {
    if (hunk.oldCount === 0 && hunk.newCount === 0) {
      return [];
    }
    const before = hunk.oldCount === 0 ? hunk.oldStart : hunk.oldStart - 1;
    return [{ before, removed: hunk.oldCount, added: hunk.newCount }];
  }
  const regions: ChangeRegion[] = [];
  let nextOld = hunk.oldCount === 0 ? hunk.oldStart + 1 : hunk.oldStart;
  let run: { before: number; removed: number; added: number } | undefined;
  for (const line of hunk.lines) {
    if (line.kind === 'context') {
      if (run !== undefined) {
        regions.push(run);
        run = undefined;
      }
      nextOld += 1;
      continue;
    }
    run ??= { before: nextOld - 1, removed: 0, added: 0 };
    if (line.kind === 'removed') {
      run.removed += 1;
      nextOld += 1;
    } else {
      run.added += 1;
    }
  }
  if (run !== undefined) {
    regions.push(run);
  }
  return regions;
}
