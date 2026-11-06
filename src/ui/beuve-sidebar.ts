import { css, html, LitElement } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { SidebarSideView } from '#contract/ipc-contract.ts';

import './beuve-sidebar-handle.ts';
import './beuve-sidebar-tabs.ts';
import type { SidebarZone } from './sidebar-zone.ts';

/**
 * The column beside the diff: a resize handle, the tabs and the panels the owner slots in (the
 * overview, the files, the review dock, the chat), of which the owner hides all but the selected one. A
 * presentational layout (ADR 0104). The handle's `beuve-sidebar-resize` and the tabs'
 * `beuve-sidebar-tab` reach the owner as they are.
 */
@customElement('beuve-sidebar')
export class BeuveSidebar extends LitElement {
  static override styles = css`
    :host {
      position: relative;
      grid-area: side;
      display: flex;
      flex-direction: column;
      min-inline-size: 0;
      min-block-size: 0;
      border-inline-start: var(--beuve-border-width) solid var(--beuve-border);
      background: var(--beuve-surface);
    }

    :host([side='left']) {
      border-inline-end: var(--beuve-border-width) solid var(--beuve-border);
      border-inline-start: none;
    }

    ::slotted(*) {
      flex: 1;
      min-block-size: 0;
      border: none;
    }

    ::slotted([hidden]) {
      display: none;
    }
  `;

  /** Which side of the workspace the sidebar is on. */
  @property({ reflect: true }) accessor side: SidebarSideView = 'right';

  /** The width now in px, or `undefined` for the stylesheet's responsive default. */
  @property({ type: Number }) accessor width: number | undefined = undefined;

  /** The tab that is showing. */
  @property() accessor selected: SidebarZone = 'files';

  /** Whether the review is a pull request, which alone has an Overview tab. */
  @property({ type: Boolean }) accessor isPullRequest = false;

  /** How many items the review has staged, shown beside its tab. */
  @property({ type: Number }) accessor stagedCount = 0;

  protected override render(): TemplateResult {
    return html`<beuve-sidebar-handle
        .side=${this.side}
        .width=${this.width}
      ></beuve-sidebar-handle>
      <beuve-sidebar-tabs
        .selected=${this.selected}
        ?isPullRequest=${this.isPullRequest}
        .stagedCount=${this.stagedCount}
      ></beuve-sidebar-tabs>
      <slot></slot>`;
  }
}
