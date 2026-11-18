import { css } from 'lit';

/**
 * Radio buttons and checkboxes (ADR 0115 amendment 2026-11-18): a `<label class="choice">`
 * around a native `<input type="radio">` or `<input type="checkbox">` and its text. The box keeps
 * the platform's shape, takes the accent color, loses the browser's margin and sits centered on
 * the text, a gap before it.
 */
export const choiceStyles = css`
  .choice {
    display: inline-flex;
    align-items: center;
    gap: var(--beuve-space-2);
  }

  .choice > input:is([type='radio'], [type='checkbox']) {
    flex: none;
    margin: 0;
    accent-color: var(--beuve-accent-solid);
  }
`;
