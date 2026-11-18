import { css } from 'lit';

/**
 * Where a text field's emoji list sits (ADR 0143), on top of `completionListStyles`: a top-layer
 * popover under the field it was opened from, above it when there is no room below, one emoji
 * per row with its `:shortcode:`.
 */
export const emojiCompletionStyles = css`
  .emoji-completions[popover] {
    margin: var(--beuve-space-0-5) 0;
    inline-size: max-content;
    min-inline-size: calc(16 * var(--beuve-measure-em));
    max-inline-size: var(--beuve-size-popover);
    text-align: start;
    position-area: block-end span-inline-end;
    position-try-fallbacks: flip-block;
  }

  .completion-emoji {
    flex: none;
  }

  .completion-name {
    overflow: hidden;
    font: var(--beuve-font-code);
    font-size: var(--beuve-font-size-caption);
    color: var(--beuve-text-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;
