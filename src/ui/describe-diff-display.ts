import type { DiffDisplayView } from '#contract/ipc-contract.ts';

/** The review header's quiet note on how diffs are shown, and its tooltip. */
export interface DiffDisplayLabel {
  readonly text: string;
  readonly title: string;
}

/**
 * Names the diff display (ADR 0042) for the review header: `Split`, `Inline`, or `Inline
 * (narrow)` when a split doesn't fit, and `· whitespace hidden` while whitespace is ignored. The
 * tooltip says which keys change it.
 */
export function describeDiffDisplay(
  display: Pick<DiffDisplayView, 'layout' | 'ignoreWhitespace'>,
  isNarrow: boolean,
): DiffDisplayLabel {
  const isSplit = display.layout === 'split';
  const layout = isSplit ? (isNarrow ? 'Inline (narrow)' : 'Split') : 'Inline';
  const text = display.ignoreWhitespace ? `${layout} · whitespace hidden` : layout;
  const layoutTitle = isSplit
    ? isNarrow
      ? 'Side by side is preferred, but the window is too narrow, so diffs are inline until it widens.'
      : 'Changes side by side; new and deleted files use the full width.'
    : 'Changes inline, in one column.';
  const whitespaceTitle = display.ignoreWhitespace
    ? 'Whitespace-only changes are hidden (git diff -w); line numbers are unchanged.'
    : 'Whitespace changes are shown.';
  return {
    text,
    title: `${layoutTitle} ${whitespaceTitle} s toggles split/inline, w toggles whitespace.`,
  };
}
