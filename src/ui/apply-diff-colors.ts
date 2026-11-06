import type { DiffColorsView } from '#contract/ipc-contract.ts';

/**
 * Sets the diff color scheme (ADR 0114) as `data-diff-colors` on the window's root element, where
 * `index.css` swaps the `--beuve-diff-*` tokens; every shadow root inherits them.
 */
export function applyDiffColors(scheme: DiffColorsView = 'red-green'): void {
  document.documentElement.dataset['diffColors'] = scheme;
}
