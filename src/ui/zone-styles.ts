import { css } from 'lit';

/** Shared chrome for zone elements: a top accent line while the zone has focus, and body padding. */
export const zoneStyles = css`
  :host {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
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
    height: 2px;
    background: transparent;
    pointer-events: none;
    transition: background 120ms;
  }

  :host([focused])::after {
    background: var(--beuve-accent);
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: var(--beuve-space-3);
  }

  h2 {
    margin: 0 0 var(--beuve-space-2);
    font: var(--beuve-font-small);
    font-weight: 600;
    color: var(--beuve-text-muted);
  }

  section + section {
    margin-top: var(--beuve-space-6);
  }

  .empty {
    margin: 0;
    color: var(--beuve-text-muted);
  }

  kbd {
    display: inline-block;
    min-width: 1.4em;
    padding: 0 var(--beuve-space-1);
    border: 1px solid var(--beuve-border);
    border-bottom-width: 2px;
    border-radius: 4px;
    background: var(--beuve-surface-sunken);
    font: var(--beuve-font-mono);
    font-size: 11px;
    text-align: center;
    color: var(--beuve-text);
  }
`;
