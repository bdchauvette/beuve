import { css, html, LitElement } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { nextRovingIndex } from './next-roving-index.ts';

/**
 * A tab list (ADR 0115) around the owner's `role="tab"` buttons, which stay in its light DOM and
 * keep their own looks. The element is the `tablist` and keeps one tab in the Tab order: the
 * selected one (`aria-selected='true'`), or the one ← → Home End moved focus to (mirrored in
 * right-to-left text). Activation is manual: Enter or Space clicks the focused tab, so the owner's
 * click handler stays the only place a tab is chosen, and an owner that moves focus into the chosen
 * panel does not cut the arrow keys short.
 */
@customElement('beuve-tab-list')
export class BeuveTabList extends LitElement {
  static override styles = css`
    :host {
      display: flex;
      align-items: center;
    }
  `;

  private readonly internals = this.attachInternals();

  private readonly selectionObserver = new MutationObserver(() => {
    this.syncTabOrder();
  });

  private readonly onSlotChange = (): void => {
    this.syncTabOrder();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const tabs = this.tabs();
    const index = nextRovingIndex({
      key: event.key,
      index: tabs.findIndex((tab) => tab.matches(':focus')),
      count: tabs.length,
      orientation: 'horizontal',
      direction: directionOf(this),
    });
    if (index === undefined) {
      return;
    }
    const next = tabs[index];
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    for (const tab of tabs) {
      tab.tabIndex = -1;
    }
    next.tabIndex = 0;
    next.focus();
  };

  /** The list's accessible name. */
  @property() accessor label = '';

  private tabs(): HTMLElement[] {
    return [...this.querySelectorAll<HTMLElement>("[role='tab']")];
  }

  private syncTabOrder(): void {
    const tabs = this.tabs();
    const selected = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true') ?? tabs[0];
    for (const tab of tabs) {
      tab.tabIndex = -1;
    }
    if (selected !== undefined) {
      selected.tabIndex = 0;
    }
  }

  override connectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.connectedCallback();
    this.internals.role = 'tablist';
    this.selectionObserver.observe(this, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-selected'],
    });
    this.syncTabOrder();
  }

  override disconnectedCallback(): void {
    this.selectionObserver.disconnect();
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.disconnectedCallback();
  }

  protected override updated(): void {
    this.internals.ariaLabel = this.label;
  }

  protected override render(): TemplateResult {
    return html`<slot @keydown=${this.onKeyDown} @slotchange=${this.onSlotChange}></slot>`;
  }
}

function directionOf(element: Element): 'ltr' | 'rtl' {
  if (getComputedStyle(element).direction === 'rtl') {
    return 'rtl';
  }
  return 'ltr';
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-tab-list': BeuveTabList;
  }
}
