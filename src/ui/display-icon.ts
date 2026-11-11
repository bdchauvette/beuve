import { svg } from 'lit';
import type { TemplateResult } from 'lit';

/**
 * The glyphs of icon-only toggles (the review header's display controls, a note's Blocking): 14px
 * outlines that follow the text color.
 */
export type DisplayIconName =
  'split' | 'inline' | 'whitespace' | 'sort' | 'chevron' | 'check' | 'blocking';

/** One header glyph, hidden from assistive technology (the button carries the label). */
export function displayIcon(name: DisplayIconName): TemplateResult {
  return svg`<svg
    viewBox="0 0 16 16"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >${shapes[name]}</svg>`;
}

const shapes: Readonly<Record<DisplayIconName, TemplateResult>> = {
  split: svg`<rect x="2" y="2.5" width="12" height="11" rx="1.5" /><path d="M8 2.5v11" />`,
  inline: svg`<rect x="2" y="2.5" width="12" height="11" rx="1.5" /><path d="M5 6h6M5 10h6" />`,
  whitespace: svg`<path d="M2.5 6.5v4h11v-4" />`,
  sort: svg`<path d="M3 4h10M3 8h7M3 12h4" />`,
  chevron: svg`<path d="M4.5 6.5 8 10l3.5-3.5" />`,
  check: svg`<path d="m3.5 8.5 3 3 6-7" />`,
  blocking: svg`<path d="M5.6 2h4.8L14 5.6v4.8L10.4 14H5.6L2 10.4V5.6Z" /><path d="M8 5v3.5M8 11h.01" />`,
};
