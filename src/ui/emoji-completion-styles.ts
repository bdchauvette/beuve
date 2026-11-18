import { css } from 'lit';

/**
 * Where a text field's emoji list sits (ADR 0145), on top of `completionListStyles`: a top-layer
 * popover that `EmojiCompletion` places at the `:name` being completed, one emoji per row with its
 * `:shortcode:`.
 */
export const emojiCompletionStyles = css`
  .emoji-completions[popover] {
    inset: auto;
    margin: 0;
    inline-size: max-content;
    min-inline-size: calc(16 * var(--beuve-measure-em));
    max-inline-size: var(--beuve-size-popover);
    text-align: start;
  }

  .completion-emoji {
    flex: none;
  }

  .completion-name {
    overflow: hidden;
    font: var(--beuve-font-code);
    color: var(--beuve-text-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;
