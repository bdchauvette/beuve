import type { DiffLayoutView } from '#contract/ipc-contract.ts';

import type { InsightMark } from './plan-insight-marks.ts';

const colors: Readonly<Record<InsightMark['severity'], string>> = {
  risk: 'var(--beuve-danger)',
  warning: 'var(--beuve-warn)',
  info: 'var(--beuve-text-muted)',
};

/**
 * The style rules that draw the gutter marks inside one `@pierre/diffs` shadow root (ADR 0061): a
 * small dot at the left edge of each marked head line's number cell, in the severity's colour.
 * Inline, the one column holds every line and deleted lines carry base numbers, so those are
 * excluded; split, the head side is its own column. Empty when there is nothing to mark.
 */
export function toInsightMarkCss(style: DiffLayoutView, marks: readonly InsightMark[]): string {
  const column = style === 'unified' ? 'unified' : 'additions';
  const cell = (line: number): string =>
    `code[data-${column}] [data-column-number='${String(line)}']:not([data-line-type='change-deletion'])`;
  return marks
    .map(
      ({ line, severity }) =>
        `${cell(line)}{position:relative}${cell(line)}::before{content:'';position:absolute;left:3px;top:50%;width:5px;height:5px;margin-top:-2.5px;border-radius:50%;background:${colors[severity]};opacity:.85}`,
    )
    .join('\n');
}
