import { css } from 'lit';

import { focusRingStyles } from './focus-ring-styles.ts';

/**
 * Buttons (ADR 0115), on a native `<button>` or `<a>` with class `button` and at most one variant:
 * none (bordered, on a surface), `primary` (the one action that moves things forward), `quiet` (no
 * chrome until hovered: toolbars, headers), `link` (text only, accent) and `icon` (square and
 * quiet: ×, toolbar icons), plus the sizes `small` for bars shorter than a control (the status
 * bar) and `large` for dialogs and empty screens. A button is at least `--beuve-size-control`
 * tall (`-small`, `-large` for the sizes), as a `.field` is (ADR 0115 amendment 2026-11-18), with
 * its content centered, so buttons and fields in one row line up; a link is as tall as its text.
 * Every variant changes its background on hover; a disabled button has faint text and no
 * pointer, never opacity. `aria-pressed='true'` marks a toggle that is on, and
 * `aria-expanded='true'` a menu trigger whose menu is open.
 */
export const buttonStyles = css`
  ${focusRingStyles}

  .button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--beuve-space-1);
    box-sizing: border-box;
    min-block-size: var(--beuve-size-control);
    padding: 0 var(--beuve-space-2);
    border: var(--beuve-border-width) solid var(--beuve-border);
    border-radius: var(--beuve-radius-small);
    background: var(--beuve-surface);
    color: var(--beuve-text);
    font: var(--beuve-font-small);
    white-space: nowrap;
    text-decoration: none;
    cursor: pointer;
  }

  .button.small {
    min-block-size: var(--beuve-size-control-small);
  }

  .button.large {
    min-block-size: var(--beuve-size-control-large);
    padding: 0 var(--beuve-space-3);
    border-radius: var(--beuve-radius);
    font: var(--beuve-font-body);
  }

  .button:hover:not(:disabled, [aria-disabled='true']) {
    background: var(--beuve-surface-hover);
  }

  .button[aria-expanded='true'],
  .button:active:not(:disabled, [aria-disabled='true']) {
    background: var(--beuve-surface-pressed);
  }

  .button[aria-pressed='true'] {
    border-color: var(--beuve-accent);
    background: var(--beuve-accent-soft);
    color: var(--beuve-accent);
  }

  .button.primary {
    border-color: var(--beuve-accent-solid);
    background: var(--beuve-accent-solid);
    color: var(--beuve-on-accent);
  }

  .button.primary:hover:not(:disabled, [aria-disabled='true']),
  .button.primary:active:not(:disabled, [aria-disabled='true']) {
    border-color: var(--beuve-accent-solid-hover);
    background: var(--beuve-accent-solid-hover);
  }

  .button.quiet,
  .button.icon {
    border-color: transparent;
    background: none;
    color: var(--beuve-text-muted);
  }

  .button.quiet[aria-expanded='true'],
  .button.quiet:hover:not(:disabled, [aria-disabled='true']),
  .button.icon:hover:not(:disabled, [aria-disabled='true']) {
    background: var(--beuve-surface-hover);
    color: var(--beuve-text);
  }

  /* After the quiet and icon looks, which would otherwise hide a pressed toggle's state. */
  .button:is(.quiet, .icon)[aria-pressed='true'] {
    border-color: var(--beuve-accent);
    background: var(--beuve-accent-soft);
    color: var(--beuve-accent);
  }

  .button.icon {
    inline-size: var(--beuve-size-control);
    block-size: var(--beuve-size-control);
    padding: 0;
    font-size: var(--beuve-font-size-large);
    line-height: 1;
  }

  .button.link {
    display: inline;
    min-block-size: 0;
    padding: 0;
    border: 0;
    background: none;
    color: var(--beuve-accent);
    font: inherit;
    text-align: start;
    white-space: normal;
  }

  .button.link:hover:not(:disabled, [aria-disabled='true']) {
    background: none;
    text-decoration: underline;
  }

  .button:disabled,
  .button[aria-disabled='true'] {
    color: var(--beuve-text-faint);
    cursor: default;
  }

  .button.primary:disabled,
  .button.primary[aria-disabled='true'] {
    border-color: var(--beuve-border);
    background: var(--beuve-surface-sunken);
  }
`;
