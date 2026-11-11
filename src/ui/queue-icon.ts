import { svg } from 'lit';
import type { TemplateResult } from 'lit';

/** The review queue's glyphs: an item's kind and the header's controls. */
export type QueueIconName = 'pull-request' | 'branch' | 'refresh' | 'filter' | 'group' | 'warning';

/** One 14px outline glyph that follows the text color, hidden from assistive technology. */
export function queueIcon(name: QueueIconName): TemplateResult {
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

const shapes: Readonly<Record<QueueIconName, TemplateResult>> = {
  'pull-request': svg`<circle cx="4" cy="3.5" r="1.5" /><circle cx="4" cy="12.5" r="1.5" /><circle cx="12" cy="12.5" r="1.5" /><path d="M4 5v6M12 11V6.5A2 2 0 0 0 10 4.5H7m1.5-1.5L7 4.5 8.5 6" />`,
  branch: svg`<circle cx="4.5" cy="3.5" r="1.5" /><circle cx="4.5" cy="12.5" r="1.5" /><circle cx="11.5" cy="5" r="1.5" /><path d="M4.5 5v6M11.5 6.5c0 3-7 2-7 4.5" />`,
  refresh: svg`<path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3" />`,
  filter: svg`<path d="M2.5 3.5h11l-4.25 5v4l-2.5 1v-5z" />`,
  group: svg`<rect x="2.5" y="2.5" width="11" height="4" rx="1" /><rect x="2.5" y="9.5" width="11" height="4" rx="1" />`,
  warning: svg`<path d="M8 2.5 14 13H2zM8 6.5v3M8 11.25v.25" />`,
};
