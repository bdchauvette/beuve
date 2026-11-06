import { css } from 'lit';

/**
 * The items of a `beuve-menu` (ADR 0115), which stay in the owner's tree: buttons with
 * `role="menuitem"`, `menuitemradio` or `menuitemcheckbox`. A radio or checkbox item's leading
 * icon shows only while `aria-checked='true'`. `.menu-heading` labels a run of items. Focus and
 * hover are a highlight, as menus show them, not the focus ring.
 */
export const menuItemStyles = css`
  [role^='menuitem'] {
    display: flex;
    align-items: center;
    gap: var(--beuve-space-2);
    box-sizing: border-box;
    inline-size: 100%;
    padding: var(--beuve-space-0-5) var(--beuve-space-2);
    border: 0;
    border-radius: var(--beuve-radius-small);
    background: none;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: pointer;
  }

  [role^='menuitem']:hover,
  [role^='menuitem']:focus-visible {
    outline: none;
    background: var(--beuve-surface-hover);
  }

  [role^='menuitem'][aria-disabled='true'] {
    color: var(--beuve-text-faint);
    cursor: default;
  }

  :is([role='menuitemradio'], [role='menuitemcheckbox']) > svg:first-child {
    flex: none;
    visibility: hidden;
  }

  :is([role='menuitemradio'], [role='menuitemcheckbox'])[aria-checked='true'] > svg:first-child {
    visibility: visible;
  }

  .menu-heading {
    margin: var(--beuve-space-2) var(--beuve-space-2) var(--beuve-space-0-5);
    color: var(--beuve-text-muted);
    font: inherit;
  }
`;
