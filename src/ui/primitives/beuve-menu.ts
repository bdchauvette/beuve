import { css, html, LitElement } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { nextRovingIndex } from './next-roving-index.ts';

const itemSelector = "[role='menuitem'], [role='menuitemradio'], [role='menuitemcheckbox']";

/**
 * A popover menu (ADR 0115). The trigger (`slot="trigger"`, a button) and the items (buttons
 * with `role="menuitem"`, `menuitemradio` or `menuitemcheckbox`, styled by `menuItemStyles`) stay
 * in the owner's light DOM, so the owner styles them and delegates their clicks. The menu opens
 * under the trigger, end-aligned, flipping when space runs out; it sets the trigger's
 * `aria-haspopup` and `aria-expanded`, moves focus with ↑ ↓ Home End, closes on Tab, Escape, a
 * click outside, or a click on an item that is not a checkbox, and gives focus back to the trigger.
 */
@customElement('beuve-menu')
export class BeuveMenu extends LitElement {
  static override styles = css`
    :host {
      display: inline-flex;
    }

    [popover] {
      margin: var(--beuve-space-1) 0 0;
      min-inline-size: 11rem;
      max-block-size: 60vh;
      overflow: auto;
      padding: var(--beuve-space-1);
      border: 1px solid var(--beuve-border);
      border-radius: var(--beuve-radius);
      background: var(--beuve-surface);
      box-shadow: var(--beuve-shadow-small);
      color: var(--beuve-text);
      font: var(--beuve-font-small);
      position-area: block-end span-inline-start;
      position-try-fallbacks: flip-block, flip-inline;
    }
  `;

  /** Whether the menu was open when the pointer went down on the trigger (light dismiss closes it first). */
  private wasOpenAtPointerDown = false;

  private readonly onTriggerPointerDown = (): void => {
    this.wasOpenAtPointerDown = this.isOpen;
  };

  private readonly onTriggerClick = (event: Event): void => {
    const trigger = this.trigger;
    if (trigger === undefined || !event.composedPath().includes(trigger)) {
      return;
    }
    const wasOpen = this.wasOpenAtPointerDown || this.isOpen;
    this.wasOpenAtPointerDown = false;
    if (wasOpen) {
      this.close();
      return;
    }
    this.panel?.showPopover({ source: trigger });
  };

  private readonly onToggle = (event: ToggleEvent): void => {
    const isOpen = event.newState === 'open';
    this.trigger?.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) {
      const items = this.items();
      (items.find((item) => item.getAttribute('aria-checked') === 'true') ?? items[0])?.focus();
      return;
    }
    if (!this.matches(':focus-within')) {
      return;
    }
    this.trigger?.focus();
  };

  private readonly onPanelKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Tab') {
      this.close();
      return;
    }
    const items = this.items();
    const index = nextRovingIndex({
      key: event.key,
      index: items.findIndex((item) => item.matches(':focus')),
      count: items.length,
      orientation: 'vertical',
    });
    if (index === undefined) {
      return;
    }
    event.preventDefault();
    items[index]?.focus();
  };

  private readonly onPanelClick = (event: Event): void => {
    const item = event.composedPath().find((target): target is HTMLElement => {
      return target instanceof HTMLElement && target.matches(itemSelector);
    });
    const isClosing =
      item !== undefined &&
      item.getAttribute('role') !== 'menuitemcheckbox' &&
      item.getAttribute('aria-disabled') !== 'true';
    if (isClosing) {
      this.close();
    }
  };

  private readonly onTriggerSlotChange = (): void => {
    this.trigger?.setAttribute('aria-haspopup', 'menu');
    this.trigger?.setAttribute('aria-expanded', String(this.isOpen));
  };

  /** The menu's accessible name. */
  @property() accessor label = '';

  private get panel(): HTMLElement | undefined {
    return this.renderRoot.querySelector<HTMLElement>('[popover]') ?? undefined;
  }

  private get trigger(): HTMLElement | undefined {
    return this.querySelector<HTMLElement>(':scope > [slot="trigger"]') ?? undefined;
  }

  private items(): HTMLElement[] {
    return [
      ...this.querySelectorAll<HTMLElement>(
        `:scope > :not([slot]) ${itemSelector}, :scope > :is(${itemSelector})`,
      ),
    ];
  }

  /** Whether the menu is showing. */
  get isOpen(): boolean {
    return this.panel?.matches(':popover-open') ?? false;
  }

  /** Closes the menu; focus goes back to the trigger if it was inside. */
  close(): void {
    if (this.isOpen) {
      this.panel?.hidePopover();
    }
  }

  protected override render(): TemplateResult {
    return html`<slot
        name="trigger"
        @slotchange=${this.onTriggerSlotChange}
        @pointerdown=${this.onTriggerPointerDown}
        @click=${this.onTriggerClick}
      ></slot>
      <div
        popover
        role="menu"
        aria-label=${this.label}
        @toggle=${this.onToggle}
        @keydown=${this.onPanelKeyDown}
        @click=${this.onPanelClick}
      >
        <slot></slot>
      </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-menu': BeuveMenu;
  }
}
