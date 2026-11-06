import { css } from 'lit';

/**
 * A short label in an outlined pill (ADR 0115): a file's status, a pull request's state, Draft,
 * Team. `data-tone` is `ok`, `warn`, `danger`, `accent` or `merged`, and colors text and outline;
 * without it the badge is muted. `dashed` marks something from outside the review. `count` is a
 * solid accent bubble for a number on a button. A `<button class="badge">` is a link-like pill.
 */
export const badgeStyles = css`
  .badge {
    --badge-color: var(--beuve-text-muted);
    display: inline-flex;
    align-items: center;
    box-sizing: border-box;
    padding: 0 var(--beuve-space-2);
    border: 1px solid var(--beuve-border);
    border-radius: var(--beuve-radius-full);
    background: none;
    color: var(--badge-color);
    font: var(--beuve-font-caption);
    line-height: 1.125rem;
    white-space: nowrap;
  }

  .badge[data-tone] {
    border-color: currentColor;
  }

  .badge[data-tone='ok'] {
    --badge-color: var(--beuve-ok);
  }

  .badge[data-tone='warn'] {
    --badge-color: var(--beuve-warn);
  }

  .badge[data-tone='danger'] {
    --badge-color: var(--beuve-danger);
  }

  .badge[data-tone='accent'] {
    --badge-color: var(--beuve-accent);
  }

  .badge[data-tone='merged'] {
    --badge-color: var(--beuve-violet);
  }

  .badge.dashed {
    border-style: dashed;
  }

  .badge.count {
    justify-content: center;
    min-inline-size: 1.125rem;
    padding: 0 var(--beuve-space-1);
    border-color: var(--beuve-accent-solid);
    background: var(--beuve-accent-solid);
    color: var(--beuve-on-accent);
    font-variant-numeric: tabular-nums;
  }

  button.badge {
    cursor: pointer;
  }

  button.badge:hover {
    border-color: var(--beuve-accent);
    color: var(--beuve-text);
  }
`;
