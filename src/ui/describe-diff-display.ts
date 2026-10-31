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
  const layout = layoutLabels[shownLayout(display, isNarrow)];
  const keys = 's toggles split/inline, w toggles whitespace.';
  if (display.ignoreWhitespace) {
    return {
      text: `${layout.text} · whitespace hidden`,
      title: `${layout.title} Whitespace-only changes are hidden (git diff -w); line numbers are unchanged. ${keys}`,
    };
  }
  return { text: layout.text, title: `${layout.title} Whitespace changes are shown. ${keys}` };
}

/** How diffs are laid out right now: split, inline by choice, or inline for want of room. */
type ShownLayout = 'split' | 'narrow' | 'inline';

const layoutLabels: Readonly<Record<ShownLayout, DiffDisplayLabel>> = {
  split: {
    text: 'Split',
    title: 'Changes side by side; new and deleted files use the full width.',
  },
  narrow: {
    text: 'Inline (narrow)',
    title:
      'Side by side is preferred, but the window is too narrow, so diffs are inline until it widens.',
  },
  inline: { text: 'Inline', title: 'Changes inline, in one column.' },
};

function shownLayout(display: Pick<DiffDisplayView, 'layout'>, isNarrow: boolean): ShownLayout {
  if (display.layout !== 'split') {
    return 'inline';
  }
  if (isNarrow) {
    return 'narrow';
  }
  return 'split';
}
