import { svg } from 'lit';
import type { TemplateResult } from 'lit';

/** The glyphs of the review header's display controls: 14px outlines that follow the text colour. */
export type DisplayIconName = 'split' | 'inline' | 'sort' | 'chevron' | 'check';

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
  sort: svg`<path d="M3 4h10M3 8h7M3 12h4" />`,
  chevron: svg`<path d="M4.5 6.5 8 10l3.5-3.5" />`,
  check: svg`<path d="m3.5 8.5 3 3 6-7" />`,
};
