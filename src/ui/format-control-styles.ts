import { css } from 'lit';

/**
 * How `pathText` shows an escaped invisible or bidi character (ADR 0082): a small boxed
 * `⟨U+202E⟩` in the warning color, so it reads as a marker and not as part of the name. Add it to
 * the `styles` of every element that renders `pathText`.
 */
export const formatControlStyles = css`
  .format-control {
    display: inline-block;
    margin-inline: var(--beuve-space-px);
    padding-inline: var(--beuve-space-0-5);
    border: var(--beuve-border-width) solid var(--beuve-warn);
    border-radius: var(--beuve-radius-small);
    color: var(--beuve-warn);
    font-family: var(--beuve-font-family-code);
    font-size: var(--beuve-font-size-mark);
    font-weight: var(--beuve-font-weight-normal);
    line-height: 1.1;
    white-space: nowrap;
  }
`;
