import type { FileReviewStateView } from '#contract/ipc-contract.ts';

import type { TreeDecoration } from './plan-tree-decorations.ts';

/**
 * The radar tree's decorations (ADR 0026) with each changed file's reviewed mark (ADR 0064) in
 * front: `✓` for reviewed, `◦` for changed since it was marked, nothing for unmarked files. Pure.
 */
export function withReviewedDecorations(
  decorations: ReadonlyMap<string, TreeDecoration>,
  marks: ReadonlyMap<string, FileReviewStateView>,
): ReadonlyMap<string, TreeDecoration> {
  const marked = [...marks].filter(([, mark]) => mark !== 'no');
  if (marked.length === 0) {
    return decorations;
  }
  const merged = new Map(decorations);
  for (const [path, mark] of marked) {
    const base = decorations.get(path);
    const sign = mark === 'yes' ? '✓' : '◦';
    const why = mark === 'yes' ? 'Reviewed' : 'Changed since you marked it reviewed';
    merged.set(path, {
      text: base === undefined ? sign : `${sign} ${base.text}`,
      title: base === undefined ? why : `${why}. ${base.title}`,
    });
  }
  return merged;
}
