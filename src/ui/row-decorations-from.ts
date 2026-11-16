import type { DiffFileView, FileReviewStateView } from '#contract/ipc-contract.ts';

import { reviewedDecorations } from './reviewed-decorations.ts';
import type { TreeDecoration } from './tree-decoration.ts';

/** What the radar tree's rows say about the review's files. */
export interface RowFacts {
  readonly files: readonly DiffFileView[];
  readonly marks: ReadonlyMap<string, FileReviewStateView>;
  readonly generated: ReadonlySet<string>;
}

const compactCount = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/**
 * The radar tree's row decorations (ADR 0026, 0052, 0064): for each changed file, its reviewed
 * mark, `gen` when it is generated, and how many lines it changes, added plus deleted and
 * abbreviated (`342`, `1.2K`). The tooltip spells each out. A file with nothing to say gets none.
 * Pure.
 */
export function rowDecorationsFrom(facts: RowFacts): ReadonlyMap<string, TreeDecoration> {
  const marked = reviewedDecorations(facts.marks);
  const decorations = new Map<string, TreeDecoration>();
  for (const file of facts.files) {
    const texts: string[] = [];
    const titles: string[] = [];
    const mark = marked.get(file.path);
    if (mark !== undefined) {
      texts.push(mark.text);
      titles.push(mark.title);
    }
    if (facts.generated.has(file.path)) {
      texts.push('gen');
      titles.push('Generated file');
    }
    const changed = file.additions + file.deletions;
    if (changed > 0) {
      texts.push(compactCount.format(changed));
      titles.push(`+${String(file.additions)} −${String(file.deletions)} lines`);
    }
    if (texts.length > 0) {
      decorations.set(file.path, { text: texts.join(' '), title: titles.join('\n') });
    }
  }
  return decorations;
}
