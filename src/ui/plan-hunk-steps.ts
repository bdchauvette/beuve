/** The parts of a `@pierre/diffs` hunk (`FileDiffMetadata.hunks`) the steps are computed from. */
export interface HunkShape {
  readonly additionStart: number;
  readonly deletionStart: number;
  readonly hunkContent: readonly (
    | { readonly type: 'context'; readonly lines: number }
    | { readonly type: 'change'; readonly additions: number; readonly deletions: number }
  )[];
}

/**
 * Where Next/Previous Change land in one hunk: its first run of changes, on the side the run starts on (removed
 * lines come first in a unified diff), as the inclusive line range to select and reveal.
 */
export interface HunkStep {
  readonly side: 'additions' | 'deletions';
  readonly start: number;
  readonly end: number;
}

/**
 * One step per hunk (ADR 0025): the first changed run. Inline, a run that removes lines is
 * selected on its deletion side, where it starts; split (ADR 0042), the head side is on the
 * right, so a run that adds lines is selected there and only a pure deletion stays on the left.
 * A hunk without changes (never produced by git) steps to its first head line.
 */
export function planHunkSteps(
  hunks: readonly HunkShape[],
  style: 'split' | 'unified' = 'unified',
): HunkStep[] {
  return hunks.map((hunk) => {
    let addition = hunk.additionStart;
    let deletion = hunk.deletionStart;
    for (const content of hunk.hunkContent) {
      if (content.type === 'context') {
        addition += content.lines;
        deletion += content.lines;
        continue;
      }
      if (content.deletions > 0 && (style === 'unified' || content.additions === 0)) {
        return { side: 'deletions', start: deletion, end: deletion + content.deletions - 1 };
      }
      if (content.additions > 0) {
        return { side: 'additions', start: addition, end: addition + content.additions - 1 };
      }
    }
    return { side: 'additions', start: hunk.additionStart, end: hunk.additionStart };
  });
}
