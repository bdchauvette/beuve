import { css } from 'lit';

/**
 * A text field's completion list (ADR 0127, 0145): the `.completion-list` surface and its
 * `.completion` rows. The highlight is the menu items' (`menuItemStyles`), since focus stays in
 * the field. Where the list sits is the field's own.
 */
export const completionListStyles = css`
  .completion-list {
    box-sizing: border-box;
    max-block-size: var(--beuve-size-window-block-40);
    overflow-block: auto;
    padding: var(--beuve-space-1);
    border: var(--beuve-border-width) solid var(--beuve-border);
    border-radius: var(--beuve-radius);
    background: var(--beuve-surface);
    box-shadow: var(--beuve-shadow-small);
    color: var(--beuve-text);
    font: var(--beuve-font-small);
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
`;
