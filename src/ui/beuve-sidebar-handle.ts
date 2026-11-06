import { css, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { SidebarSideView } from '#contract/ipc-contract.ts';

import { clampSidebarWidth } from './clamp-sidebar-width.ts';
import { sidebarWidthForKey } from './sidebar-width-for-key.ts';
import { sidebarWidthLimits } from './sidebar-width-limits.ts';

/** The width the reviewer dragged the sidebar to; `undefined` goes back to the default. */
export interface SidebarResizeDetail {
  readonly width: number | undefined;
}

/**
 * The strip on the sidebar's inner edge that resizes it: drag it, use the arrow keys (Shift for
 * bigger steps) or double-click to go back to the default width. It sits in the sidebar's shadow
 * root, and the sidebar sits in the workspace; it reads their sizes from there. Emits `beuve-sidebar-resize`
 * with a {@link SidebarResizeDetail}; the owner stores the width and sets it on the workspace.
 */
@customElement('beuve-sidebar-handle')
export class BeuveSidebarHandle extends LitElement {
  static override styles = css`
    :host {
      position: absolute;
      z-index: 2;
      inset-block-start: 0;
      inset-block-end: 0;
      inset-inline-start: calc(var(--beuve-size-handle) / -2);
      inline-size: var(--beuve-size-handle);
      cursor: col-resize;
      touch-action: none;
    }

    :host([side='left']) {
      inset-inline-end: calc(var(--beuve-size-handle) / -2);
      inset-inline-start: auto;
    }

    :host(:hover),
    :host(:focus-visible),
    :host([dragging]) {
      background: var(--beuve-border);
      outline: none;
    }
  `;

  private readonly down = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }
    this.setPointerCapture(event.pointerId);
    this.dragging = true;
    event.preventDefault();
  };

  private readonly move = (event: PointerEvent): void => {
    if (!this.dragging) {
      return;
    }
    const workspace = this.sidebar()?.parentElement;
    if (workspace === null || workspace === undefined) {
      return;
    }
    const bounds = workspace.getBoundingClientRect();
    let width = bounds.right - event.clientX;
    if (this.side === 'left') {
      width = event.clientX - bounds.left;
    }
    this.resize(clampSidebarWidth({ width, available: bounds.width }));
  };

  private readonly up = (event: PointerEvent): void => {
    if (this.hasPointerCapture(event.pointerId)) {
      this.releasePointerCapture(event.pointerId);
    }
    this.dragging = false;
  };

  private readonly reset = (): void => {
    this.resize(undefined);
  };

  private readonly press = (event: KeyboardEvent): void => {
    const sidebar = this.sidebar();
    const workspace = sidebar?.parentElement;
    if (sidebar === undefined || workspace === null || workspace === undefined) {
      return;
    }
    const width = sidebarWidthForKey({
      key: event.key,
      isShift: event.shiftKey,
      side: this.side,
      current: sidebar.getBoundingClientRect().width,
      available: workspace.clientWidth,
    });
    if (width === undefined) {
      return;
    }
    this.resize(width);
    event.preventDefault();
  };

  /** Which side of the workspace the sidebar is on. */
  @property({ reflect: true }) accessor side: SidebarSideView = 'right';

  /** The width now in px, or `undefined` for the stylesheet's responsive default. */
  @property({ type: Number }) accessor width: number | undefined = undefined;

  @property({ type: Boolean, reflect: true }) accessor dragging = false;

  /** The sidebar element this handle sits in; the workspace is its parent. */
  private sidebar(): HTMLElement | undefined {
    const root = this.getRootNode();
    if (root instanceof ShadowRoot && root.host instanceof HTMLElement) {
      return root.host;
    }
    return undefined;
  }

  private resize(width: number | undefined): void {
    this.dispatchEvent(
      new CustomEvent<SidebarResizeDetail>('beuve-sidebar-resize', {
        detail: { width },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override connectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.connectedCallback();
    this.role = 'separator';
    this.ariaOrientation = 'vertical';
    this.ariaLabel = 'Resize sidebar';
    this.ariaValueMin = String(sidebarWidthLimits.min);
    this.tabIndex = 0;
    this.addEventListener('pointerdown', this.down);
    this.addEventListener('pointermove', this.move);
    this.addEventListener('pointerup', this.up);
    this.addEventListener('pointercancel', this.up);
    this.addEventListener('dblclick', this.reset);
    this.addEventListener('keydown', this.press);
  }

  override disconnectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.disconnectedCallback();
    this.removeEventListener('pointerdown', this.down);
    this.removeEventListener('pointermove', this.move);
    this.removeEventListener('pointerup', this.up);
    this.removeEventListener('pointercancel', this.up);
    this.removeEventListener('dblclick', this.reset);
    this.removeEventListener('keydown', this.press);
  }

  protected override willUpdate(): void {
    this.ariaValueNow = String(this.width ?? 0);
  }
}
