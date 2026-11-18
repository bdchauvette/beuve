import { css } from 'lit';

/**
 * Where the chat input's command list sits (ADR 0127), on top of `completionListStyles`: above
 * the input, shown while the input has focus, one command per row with its usage and a one-line
 * description.
 */
export const chatCompletionStyles = css`
  form {
    position: relative;
  }

  .completions {
    position: absolute;
    inset-block-end: 100%;
    inset-inline: var(--beuve-space-3);
    z-index: 1;
    margin: 0 0 var(--beuve-space-1);
  }

  form:not(:focus-within) .completions {
    display: none;
  }

  .completion-usage {
    flex: none;
    font: var(--beuve-font-code);
    font-size: var(--beuve-font-size-caption);
    color: var(--beuve-text);
  }

  .completion-help {
    overflow: hidden;
    color: var(--beuve-text-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;
