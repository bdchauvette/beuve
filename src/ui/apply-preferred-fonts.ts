import type { DiffDisplayView } from '#contract/ipc-contract.ts';

/** The reviewer's font preferences (ADR 0122), as `display:get` answers them. */
export type PreferredFonts = Pick<DiffDisplayView, 'fontFamilyMono' | 'fontFamilySans'>;

/**
 * Sets the preferred code and interface fonts on the window's root, where `index.css` puts them
 * ahead of Commit Mono and the system font; an empty preference clears its property. Every shadow
 * root inherits them. Main has already checked each is a plain `font-family` list.
 */
export function applyPreferredFonts(fonts: PreferredFonts): void {
  const { style } = document.documentElement;
  const families: readonly (readonly [string, string | undefined])[] = [
    ['--beuve-preferred-font-family-mono', fonts.fontFamilyMono],
    ['--beuve-preferred-font-family-sans', fonts.fontFamilySans],
  ];
  for (const [property, family] of families) {
    if (family === undefined || family === '') {
      style.removeProperty(property);
    } else {
      style.setProperty(property, family);
    }
  }
}
