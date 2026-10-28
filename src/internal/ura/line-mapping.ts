/**
 * A hunk of a diff between two heads. Git's `DiffHunk` satisfies this structurally. With `lines`,
 * only runs of added and removed lines count as changed; without them the whole hunk does, which
 * is exact for zero-context diffs (`contextLines: 0`).
 */
export interface LineMappingHunk {
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
  readonly lines?: readonly { readonly kind: 'context' | 'added' | 'removed' }[];
}

/** How one file changed between the heads. Files that didn't change are simply absent. */
export type FileLineMapping =
  | {
      readonly kind: 'modified';
      readonly path: string;
      readonly hunks: readonly LineMappingHunk[];
    }
  | {
      readonly kind: 'renamed';
      readonly oldPath: string;
      readonly newPath: string;
      readonly hunks: readonly LineMappingHunk[];
    }
  | { readonly kind: 'deleted'; readonly path: string };

/**
 * An interdiff-style line mapping from `fromHeadSha` to `toHeadSha`: main builds it from the git
 * diff between the two heads (with rename detection; added files are irrelevant and may be left
 * out). Hunks are in file order.
 */
export interface LineMapping {
  readonly fromHeadSha: string;
  readonly toHeadSha: string;
  readonly files: readonly FileLineMapping[];
}
