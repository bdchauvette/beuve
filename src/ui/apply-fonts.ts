import type { DiffDisplayView } from '#contract/ipc-contract.ts';

/** The preferences each window applies, and the custom property each one sets. */
const preferences = [
  ['codeFont', '--beuve-preferred-code-font'],
  ['proseFont', '--beuve-preferred-prose-font'],
] as const;

/**
 * Sets the reviewer's code font (ADR 0122) and prose font (ADR 0124) on the window's root as
 * `--beuve-preferred-code-font` and `--beuve-preferred-prose-font`, where `index.css` puts them
 * ahead of Commit Mono and IBM Plex Sans; an empty preference clears its property. Every shadow
 * root inherits them. Main has already checked each is a plain `font-family` list.
 */
export function applyFonts(display: Pick<DiffDisplayView, 'codeFont' | 'proseFont'>): void {
  const { style } = document.documentElement;
  for (const [key, property] of preferences) {
    const family = display[key] ?? '';
    if (family === '') {
      style.removeProperty(property);
    } else {
      style.setProperty(property, family);
    }
  }
}
