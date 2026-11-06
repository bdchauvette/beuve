import { css } from 'lit';

import { emptyStateStyles } from './primitives/empty-state-styles.ts';

/** Shared chrome for zone elements: a top accent line while the zone has focus, body padding, and the empty state (ADR 0115). */
export const zoneStyles = css`
  ${emptyStateStyles}

  :host {
    display: flex;
    flex-direction: column;
    min-inline-size: 0;
    min-block-size: 0;
    position: relative;
    background: var(--beuve-surface);
    outline: none;
  }

  /* No title bars: the focused region shows a thin accent line along its top edge. */
  :host::after {
    content: '';
    position: absolute;
    inset: 0 0 auto;
    z-index: 4;
    block-size: var(--beuve-border-width-thick);
    background: transparent;
    pointer-events: none;
    transition: background 120ms;
  }

  :host([focused])::after {
    background: var(--beuve-accent);
  }

  .body {
    flex: 1;
    min-block-size: 0;
    overflow: auto;
    padding: var(--beuve-space-3);
  }

  h2 {
    margin: 0 0 var(--beuve-space-2);
    font: var(--beuve-font-small);
    font-weight: var(--beuve-font-weight-semibold);
    color: var(--beuve-text-muted);
  }

  section + section {
    margin-block-start: var(--beuve-space-6);
  }
`;
