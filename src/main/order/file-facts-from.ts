import type { DiffFile } from '#internal/git/diff-model.ts';
import type { FileFacts } from '#internal/session/mechanical-rules.ts';

import { headPathOf } from '../sessions/head-path-of.ts';

/** What git says about the review's files, gathered once per order. */
export interface ReviewFileEvidence {
  /** Head paths with `linguist-generated` set. */
  readonly generated: ReadonlySet<string>;
  /** Head paths of the `--ignore-all-space` diff that still have changed lines. */
  readonly changedIgnoringWhitespace: ReadonlySet<string>;
}

/** The facts the classifier needs about one file of the plain diff. Pure. */
export function fileFactsFrom(file: DiffFile, evidence: ReviewFileEvidence): FileFacts {
  const path = headPathOf(file);
  const hasChangedLines = file.hunks.some((hunk) =>
    hunk.lines.some((line) => line.kind !== 'context'),
  );
  return {
    isGenerated: evidence.generated.has(path),
    isWhitespaceOnly:
      !file.binary && hasChangedLines && !evidence.changedIgnoringWhitespace.has(path),
    isPureRename: file.status === 'renamed' && file.similarity === 100,
  };
}
