import { svg } from 'lit';
import type { TemplateResult } from 'lit';

/**
 * The glyphs of icon-only controls (the review header's display controls, a note's Blocking, the
 * queue's Refresh and the titlebar's Reload) and of the status bar (its branches, the language
 * servers and the GitHub account): 14px outlines that
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
  | 'pop-out'
  | 'refresh'
  | 'branch'
  | 'braces'
  | 'account';

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
  'pop-out': svg`<path d="M9.5 2.5h4v4M13.5 2.5 8 8" /><path d="M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3" />`,
  braces: svg`<path d="M5.5 2.5c-1.3 0-2 .6-2 1.8v1.9c0 .9-.5 1.5-1.5 1.8 1 .3 1.5.9 1.5 1.8v1.9c0 1.2.7 1.8 2 1.8M10.5 2.5c1.3 0 2 .6 2 1.8v1.9c0 .9.5 1.5 1.5 1.8-1 .3-1.5.9-1.5 1.8v1.9c0 1.2-.7 1.8-2 1.8" />`,
  account: svg`<circle cx="8" cy="5.5" r="2.5" /><path d="M3 13.5c.8-2.4 2.7-3.5 5-3.5s4.2 1.1 5 3.5" />`,
  branch: svg`<circle cx="5" cy="3.5" r="1.5" /><circle cx="5" cy="12.5" r="1.5" /><circle cx="11" cy="4.5" r="1.5" /><path d="M5 5v6M11 6v.5A3 3 0 0 1 8 9.5H5" />`,
  refresh: svg`<path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3" />`,
  blocking: svg`<path d="M5.6 2h4.8L14 5.6v4.8L10.4 14H5.6L2 10.4V5.6Z" /><path d="M8 5v3.5M8 11h.01" />`,
};
