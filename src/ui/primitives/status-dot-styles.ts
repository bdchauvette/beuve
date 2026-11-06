import { css } from 'lit';

/**
 * A small round status light (ADR 0115): `<span class="status-dot" data-tone="ok">`. Tones are
 * `ok`, `warn`, `danger`, `accent` (busy) and `merged`; anything else is muted. Put the meaning in
 * the text or title beside it, never in the color alone.
 */
export const statusDotStyles = css`
  .status-dot {
    display: inline-block;
    flex: none;
    inline-size: var(--beuve-size-dot);
    block-size: var(--beuve-size-dot);
    border-radius: var(--beuve-radius-full);
    background: var(--beuve-text-faint);
  }

  .status-dot[data-tone='ok'] {
    background: var(--beuve-ok-solid);
  }

  .status-dot[data-tone='warn'] {
    background: var(--beuve-warn-solid);
  }

  .status-dot[data-tone='danger'] {
    background: var(--beuve-danger-solid);
  }

  .status-dot[data-tone='accent'] {
    background: var(--beuve-accent-solid);
  }

  .status-dot[data-tone='merged'] {
    background: var(--beuve-violet);
  }
`;
