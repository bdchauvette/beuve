import { css } from 'lit';

/**
 * How rendered Markdown (ADR 0073) looks inside a `.body` element of a sidebar card: compact
 * blocks, tables that scroll sideways, code in the mono font. Share it, add the card's own
 * `.body` size and font beside it.
 */
export const markdownBodyStyles = css`
  .body :is(p, ul, ol, blockquote, hr, h1, h2, h3, h4, h5, h6, .table) {
    margin: 0 0 var(--beuve-space-2);
  }

  .body :is(h1, h2, h3, h4, h5, h6) {
    font: inherit;
    font-weight: 600;
  }

  .body :is(ul, ol) {
    padding-left: var(--beuve-space-4);
  }

  .body blockquote {
    padding-left: var(--beuve-space-2);
    border-left: 2px solid var(--beuve-border);
    color: var(--beuve-text-muted);
  }

  .body .table {
    overflow-x: auto;
  }

  .body table {
    border-collapse: collapse;
    font: inherit;
  }

  .body :is(th, td) {
    padding: 2px var(--beuve-space-2);
    border: 1px solid var(--beuve-border);
    text-align: start;
    vertical-align: top;
    overflow-wrap: normal;
  }

  .body th {
    background: var(--beuve-surface-sunken);
    font-weight: 600;
  }

  .body .align-center {
    text-align: center;
  }

  .body .align-right {
    text-align: end;
  }

  .body pre {
    margin: 0 0 var(--beuve-space-2);
    padding: var(--beuve-space-1) var(--beuve-space-2);
    overflow: auto;
    border-radius: var(--beuve-radius);
    background: var(--beuve-surface-sunken);
    font: var(--beuve-font-mono);
    font-size: 11px;
  }

  code {
    font: var(--beuve-font-mono);
    font-size: 11px;
  }
`;
