import type { FileReviewStateView } from '#contract/ipc-contract.ts';

import type { TreeDecoration } from './tree-decoration.ts';

/**
 * The radar tree's decorations (ADR 0026): each changed file's reviewed mark (ADR 0064), `✓` for
 * reviewed and `◦` for changed since it was marked. Unmarked files get none. Pure.
 */
export function reviewedDecorations(
  marks: ReadonlyMap<string, FileReviewStateView>,
): ReadonlyMap<string, TreeDecoration> {
  const decorations = new Map<string, TreeDecoration>();
  for (const [path, mark] of marks) {
    if (mark === 'no') {
      continue;
    }
    const { sign, why } = markLabelsOf(mark);
    decorations.set(path, { text: sign, title: why });
  }
  return decorations;
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
