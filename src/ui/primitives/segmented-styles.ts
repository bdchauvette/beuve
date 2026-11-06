import { css } from 'lit';

import { focusRingStyles } from './focus-ring-styles.ts';

/**
 * A segmented control (ADR 0115): `<span class="segmented" role="radiogroup">` around buttons
 * with `role="radio"` and `aria-checked`, or a `role="group"` of `aria-pressed` toggles. The
 * chosen segment is the one marked true.
 */
export const segmentedStyles = css`
  ${focusRingStyles}

  .segmented {
    display: inline-flex;
    overflow: hidden;
    border: var(--beuve-border-width) solid var(--beuve-border);
    border-radius: var(--beuve-radius-small);
  }

  .segmented > button {
    display: inline-flex;
    align-items: center;
    gap: var(--beuve-space-1);
    padding: var(--beuve-space-0-5) var(--beuve-space-2);
    border: 0;
    border-radius: 0;
    background: none;
    color: var(--beuve-text-muted);
    font: inherit;
    cursor: pointer;
  }

  .segmented > button + button {
    border-inline-start: var(--beuve-border-width) solid var(--beuve-border);
  }

  .segmented > button:hover {
    background: var(--beuve-surface-hover);
    color: var(--beuve-text);
  }

  .segmented > button:is([aria-checked='true'], [aria-pressed='true']) {
    background: var(--beuve-surface-sunken);
    color: var(--beuve-text);
  }
`;
