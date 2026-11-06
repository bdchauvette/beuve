import { css } from 'lit';

/** A key as a keycap (ADR 0115): the command palette's key column and the shortcuts window. */
export const kbdStyles = css`
  kbd {
    display: inline-block;
    min-inline-size: calc(1.4 * var(--beuve-measure-em));
    padding: 0 var(--beuve-space-1);
    border: var(--beuve-border-width) solid var(--beuve-border);
    border-block-end-width: var(--beuve-border-width-thick);
    border-radius: var(--beuve-radius-small);
    background: var(--beuve-surface-sunken);
    color: var(--beuve-text);
    font: var(--beuve-font-mono);
    font-size: var(--beuve-font-size-caption);
    text-align: center;
  }
`;
