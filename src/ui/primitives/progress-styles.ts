import { css } from 'lit';

/**
 * An indeterminate progress bar (ADR 0115, 0144): `<span class="progress" aria-hidden="true">`,
 * a thin track with an accent segment sliding along it. Put what is in progress in a
 * `role="status"` text beside it; the bar only says that something is. Under reduced motion it
 * holds still, half lit.
 */
export const progressStyles = css`
  .progress {
    position: relative;
    display: block;
    inline-size: var(--beuve-size-field);
    block-size: var(--beuve-border-width-heavy);
    overflow: hidden;
    border-radius: var(--beuve-radius-tiny);
    background: var(--beuve-accent-soft);
  }

  .progress::after {
    position: absolute;
    inset-block: 0;
    inset-inline: 0 auto;
    inline-size: 40%;
    border-radius: inherit;
    background: var(--beuve-accent);
    content: '';
    animation: progress-slide 1.1s ease-in-out infinite;
  }

  @keyframes progress-slide {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(250%);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .progress::after {
      inline-size: 100%;
      animation: none;
      opacity: 0.6;
    }
  }
`;
