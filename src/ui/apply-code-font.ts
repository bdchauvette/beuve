import type { DiffDisplayView } from '#contract/ipc-contract.ts';

/**
 * Sets the reviewer's code font (ADR 0122) on the window's root as `--beuve-preferred-code-font`,
 * where `index.css` puts it ahead of Commit Mono; an empty preference clears it. Every shadow root
 * inherits it. Main has already checked it is a plain `font-family` list.
 */
export function applyCodeFont(display: Pick<DiffDisplayView, 'codeFont'>): void {
  const { style } = document.documentElement;
  const family = display.codeFont ?? '';
  if (family === '') {
    style.removeProperty('--beuve-preferred-code-font');
    return;
  }
  style.setProperty('--beuve-preferred-code-font', family);
}
