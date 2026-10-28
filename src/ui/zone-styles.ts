import { css } from 'lit';

/** Shared chrome for zone elements: a header that lights up when the zone has focus. */
export const zoneStyles = css`
  :host {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--beuve-surface);
    outline: none;
  }

  header {
    display: flex;
    align-items: center;
    gap: var(--beuve-space-2);
    height: 32px;
    flex: none;
    padding: 0 var(--beuve-space-3);
    border-bottom: 1px solid var(--beuve-border);
    font: var(--beuve-font-small);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--beuve-text-muted);
  }

  :host([focused]) header {
    color: var(--beuve-accent);
    box-shadow: inset 0 -2px 0 var(--beuve-accent);
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
