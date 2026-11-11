/**
 * Style sheet text for a `@pierre/diffs` shadow root that layers a line selection over whatever
 * the row already shows, as translucent layers composite (ADR 0114 amendment). The library would
 * mix the selection color into the row's own (a changed line's tint, the code background) at
 * 18% (25% dark), replacing that tint and fading the selection; with the mix at 100% the row
 * keeps its own color, and the selection paints as a background image above it, under changed
 * words and highlights. The colors are the `--beuve-diff-selection-*` tokens, which inherit
 * into the shadow root.
 */
export const diffSelectionCss = [
  '[data-selected-line] { --mix-selection-light: 100%; --mix-selection-dark: 100%; }',
  ':is([data-line], [data-no-newline])[data-selected-line] { background-image: linear-gradient(var(--beuve-diff-selection-bg), var(--beuve-diff-selection-bg)); }',
  ':is([data-gutter-buffer], [data-column-number])[data-selected-line] { background-image: linear-gradient(var(--beuve-diff-selection-number-bg), var(--beuve-diff-selection-number-bg)); }',
].join('\n');
