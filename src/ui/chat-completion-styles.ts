import { css } from 'lit';

/**
 * The chat input's command list (ADR 0127): a listbox above the input, shown while the input has
 * focus, one command per row with its usage and a one-line description. The highlight is the
 * menu items' (`menuItemStyles`), since focus stays in the input.
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
    max-block-size: var(--beuve-size-window-block-40);
    overflow-block: auto;
    margin: 0 0 var(--beuve-space-1);
    padding: var(--beuve-space-1);
    border: var(--beuve-border-width) solid var(--beuve-border);
    border-radius: var(--beuve-radius);
    background: var(--beuve-surface);
    box-shadow: var(--beuve-shadow-small);
    font: var(--beuve-font-small);
  }

  form:not(:focus-within) .completions {
    display: none;
  }

  .completion {
    display: flex;
    gap: var(--beuve-space-2);
    align-items: baseline;
    min-inline-size: 0;
    padding: var(--beuve-space-0-5) var(--beuve-space-2);
    border-radius: var(--beuve-radius-small);
    cursor: pointer;
  }

  .completion:hover,
  .completion[aria-selected='true'] {
    background: var(--beuve-surface-hover);
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
