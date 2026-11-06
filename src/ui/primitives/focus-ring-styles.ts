import { css } from 'lit';

/**
 * The one keyboard focus ring (ADR 0115): `--beuve-focus-ring` on buttons, links, form controls
 * and anything focusable by `tabindex`, only when the browser decides focus should show.
 */
export const focusRingStyles = css`
  :where(button, a, input, select, textarea, summary, [tabindex]):focus-visible {
    outline: var(--beuve-focus-ring);
    outline-offset: var(--beuve-focus-ring-offset);
  }
`;
