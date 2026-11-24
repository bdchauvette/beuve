import { svg } from 'lit';
import type { TemplateResult } from 'lit';

/**
 * The glyphs of icon-only controls (the review header's display controls, a note's Blocking, the
 * queue's Refresh and the titlebar's Reload) and of the status bar's branches: 14px outlines that
 * follow the text color.
 */
export type DisplayIconName =
  | 'split'
  | 'inline'
  | 'whitespace'
  | 'sort'
  | 'chevron'
  | 'check'
  | 'dash'
  | 'blocking'
  | 'sheet'
  | 'refresh'
  | 'branch';

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
  dash: svg`<path d="M4 8h8" />`,
  sheet: svg`<path d="M9.5 2.5h-5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-7Z" /><path d="M9.5 2.5v3a1 1 0 0 0 1 1h2M6 9h4M6 11.5h4" />`,
  branch: svg`<circle cx="5" cy="3.5" r="1.5" /><circle cx="5" cy="12.5" r="1.5" /><circle cx="11" cy="4.5" r="1.5" /><path d="M5 5v6M11 6v.5A3 3 0 0 1 8 9.5H5" />`,
  refresh: svg`<path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3" />`,
  blocking: svg`<path d="M5.6 2h4.8L14 5.6v4.8L10.4 14H5.6L2 10.4V5.6Z" /><path d="M8 5v3.5M8 11h.01" />`,
};
