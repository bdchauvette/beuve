import { css } from 'lit';

/**
 * Single-line fields (ADR 0115 amendment 2026-11-18), on a native `<input>` or `<select>` with
 * class `field`: bordered, on the page background, with the accent border while focused. A field
 * is as tall as a `.button` (`--beuve-size-control`), so a field and the buttons beside it line
 * up; `small` and `large` match `.button.small` and `.button.large`. Text is the body size, as
 * inputs take it, and centered in the height. Width and a field's font family (code, for a find
 * or a path) stay the owner's.
 */
export const fieldStyles = css`
  .field {
    box-sizing: border-box;
    min-inline-size: 0;
    block-size: var(--beuve-size-control);
    padding: 0 var(--beuve-space-2);
    border: var(--beuve-border-width) solid var(--beuve-border);
    border-radius: var(--beuve-radius-small);
    background: var(--beuve-bg);
    color: var(--beuve-text);
    font: var(--beuve-font-body);
  }

  .field.small {
    block-size: var(--beuve-size-control-small);
    font: var(--beuve-font-small);
  }

  .field.large {
    block-size: var(--beuve-size-control-large);
    border-radius: var(--beuve-radius);
  }

  .field:focus {
    border-color: var(--beuve-accent);
    outline: none;
  }

  .field:disabled {
    color: var(--beuve-text-faint);
  }
`;
