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
    const { sign, why } = markLabelsOf(mark);
    const base = decorations.get(path);
    if (base === undefined) {
      merged.set(path, { text: sign, title: why });
    } else {
      merged.set(path, { text: `${sign} ${base.text}`, title: `${why}. ${base.title}` });
    }
  }
  return merged;
}

/** The sign in front of a marked file, and what its tooltip says. */
interface MarkLabels {
  readonly sign: string;
  readonly why: string;
}

function markLabelsOf(mark: FileReviewStateView): MarkLabels {
  if (mark === 'yes') {
    return { sign: '✓', why: 'Reviewed' };
  }
  return { sign: '◦', why: 'Changed since you marked it reviewed' };
}
