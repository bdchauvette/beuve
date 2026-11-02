import { css, html, LitElement } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { SidebarSideView } from '#contract/ipc-contract.ts';

/**
 * The grid under the titlebar: the `main` slot and, beside it, the `sidebar` slot. With no
 * sidebar the main area has the row to itself. A presentational layout (ADR 0104): the owner
 * renders both areas into it and keeps owning them.
 */
@customElement('beuve-workspace')
export class BeuveWorkspace extends LitElement {
  static override styles = css`
    :host {
      display: grid;
      min-height: 0;
      grid-template-columns: minmax(0, 1fr) var(--beuve-sidebar-width);
      grid-template-areas: 'main side';
    }

    :host([side='left']) {
      grid-template-columns: var(--beuve-sidebar-width) minmax(0, 1fr);
      grid-template-areas: 'side main';
    }

    :host(:not([hassidebar])) {
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas: 'main';
    }
  `;

  /** Which side the sidebar is on. */
  @property({ reflect: true }) accessor side: SidebarSideView = 'right';

  /** Whether the sidebar shows; without it the main area fills the row. */
  @property({ type: Boolean, reflect: true }) accessor hasSidebar = false;

  /** The dragged sidebar width in px, or `undefined` for the stylesheet's responsive default. */
  @property({ type: Number }) accessor sidebarWidth: number | undefined = undefined;

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has('sidebarWidth')) {
      return;
    }
    if (this.sidebarWidth === undefined) {
      this.style.removeProperty('--beuve-sidebar-width');
    } else {
      this.style.setProperty('--beuve-sidebar-width', `${String(this.sidebarWidth)}px`);
    }
  }

  protected override render(): TemplateResult {
    return html`<slot name="main"></slot><slot name="sidebar"></slot>`;
  }
}
