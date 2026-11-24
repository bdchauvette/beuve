import { css } from 'lit';

import { focusRingStyles } from './focus-ring-styles.ts';

/**
 * A segmented control (ADR 0115): `<span class="segmented" role="radiogroup">` around buttons
 * with `role="radio"` and `aria-checked`, or a `role="group"` of `aria-pressed` toggles. The
 * chosen segment is the one marked true, filled with the accent and underlined by an accent bar.
 * A segment is as tall as a `.button` (`--beuve-size-control`, inside the border), with its
 * content centered, so the bar leaves the text room and the control lines up with the buttons and
 * fields beside it.
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
    min-block-size: calc(var(--beuve-size-control) - 2 * var(--beuve-border-width));
    padding: 0 var(--beuve-space-2);
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

  .segmented > button:not([aria-checked='true'], [aria-pressed='true']):hover {
    background: var(--beuve-surface-hover);
    color: var(--beuve-text);
  }

  /*
   * The chosen segment: the pressed toggle button's accent fill and text, and an accent bar along
   * its bottom edge, so the state does not rest on color alone. An inset shadow draws the bar, so
   * the control does not change size. Hovering it changes nothing.
   */
  .segmented > button:is([aria-checked='true'], [aria-pressed='true']) {
    background: var(--beuve-accent-soft);
    box-shadow: inset 0 calc(-1 * var(--beuve-border-width-thick)) 0 var(--beuve-accent);
    color: var(--beuve-accent);
  }
`;
