import { css } from 'lit';

/**
 * How `pathText` shows an escaped invisible or bidi character (ADR 0082): a small boxed
 * `⟨U+202E⟩` in the warning colour, so it reads as a marker and not as part of the name. Add it to
 * the `styles` of every element that renders `pathText`.
 */
export const formatControlStyles = css`
  .format-control {
    display: inline-block;
    margin-inline: 1px;
    padding-inline: 2px;
    border: 1px solid var(--beuve-warn);
    border-radius: var(--beuve-radius-small);
    color: var(--beuve-warn);
    font-family: var(--beuve-font-family-mono);
    font-size: 0.85em;
    font-weight: var(--beuve-font-weight-normal);
    line-height: 1.1;
    white-space: nowrap;
  }
`;
