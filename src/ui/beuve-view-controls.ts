import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { DiffDisplayView, ReviewOrderMode, ReviewOrderView } from '#contract/ipc-contract.ts';

import { ActionDelegation } from './action-delegation.ts';
import { describeDiffDisplay } from './describe-diff-display.ts';
import { describeOrderFallback } from './describe-order-fallback.ts';
import { displayIcon } from './display-icon.ts';
import { buttonStyles } from './primitives/button-styles.ts';
import { menuItemStyles } from './primitives/menu-item-styles.ts';
import { segmentedStyles } from './primitives/segmented-styles.ts';
import { withPayload } from './with-payload.ts';
import './primitives/beuve-menu.ts';

const orderModes: readonly { readonly mode: ReviewOrderMode; readonly label: string }[] = [
  { mode: 'path', label: 'Path' },
  { mode: 'imports', label: 'Imports' },
  { mode: 'calls', label: 'Calls' },
  { mode: 'size', label: 'Size' },
];

const layouts: readonly DiffDisplayView['layout'][] = ['split', 'unified'];

/**
 * How the diff is shown, in the title band (ADR 0157 amendment): the file order menu (ADR 0065,
 * 0107), with a dot when the order fell back to Path, the split and inline segments (dashed while
 * split is chosen but the diff is too narrow for it) and Hide Whitespace (ADR 0042). Emits
 * `beuve-display-change` with the `Partial<DiffDisplayView>` to apply.
 */
@customElement('beuve-view-controls')
export class BeuveViewControls extends LitElement {
  static override styles = [
    buttonStyles,
    menuItemStyles,
    segmentedStyles,
    css`
      :host {
        display: inline-flex;
        flex: none;
        align-items: center;
        gap: var(--beuve-space-2);
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
        white-space: nowrap;
      }

      .order-button {
        border-color: var(--beuve-border);
      }

      .fell-back .order-button::after {
        content: '';
        inline-size: var(--beuve-size-dot-small);
        block-size: var(--beuve-size-dot-small);
        border-radius: 50%;
        background: var(--beuve-warn-solid);
      }

      .tools {
        display: inline-flex;
        align-items: center;
        gap: var(--beuve-space-2);
      }

      .segmented > button.effective {
        outline: var(--beuve-border-width) dashed var(--beuve-text-muted);
        outline-offset: calc(-1 * var(--beuve-border-width-heavy));
      }
    `,
  ];

  /** The display preferences (`settings.json`, ADR 0042). */
  @property({ attribute: false }) accessor display: DiffDisplayView | undefined;

  /** The order main computed, which says when it fell back. */
  @property({ attribute: false }) accessor order: ReviewOrderView | undefined;

  /** The open review's head; an order computed for another head is stale. */
  @property() accessor headSha = '';

  /** The diff is too narrow for split, so a split choice shows inline. */
  @property({ type: Boolean }) accessor isNarrow = false;

  constructor() {
    super();
    this.addController(
      new ActionDelegation(this, {
        click: {
          order: withPayload(
            ({ mode }) => {
              return orderModes.find((entry) => entry.mode === mode)?.mode;
            },
            (mode): void => {
              if (mode !== (this.display?.reviewOrder ?? 'path')) {
                this.changeDisplay({ reviewOrder: mode });
              }
            },
          ),
          layout: withPayload(
            ({ layout }) => {
              return layouts.find((entry) => entry === layout);
            },
            (layout): void => {
              this.changeDisplay({ layout });
            },
          ),
          whitespace: (): void => {
            this.changeDisplay({ ignoreWhitespace: this.display?.ignoreWhitespace !== true });
          },
        },
      }),
    );
  }

  private changeDisplay(change: Partial<DiffDisplayView>): void {
    this.dispatchEvent(
      new CustomEvent('beuve-display-change', { detail: change, bubbles: true, composed: true }),
    );
  }

  /** A sort button whose menu lists Path / Imports / Calls / Size (ADR 0065, 0107). */
  private renderOrder(display: DiffDisplayView): TemplateResult {
    const requested = display.reviewOrder ?? 'path';
    let { order } = this;
    if (order?.headSha !== this.headSha) {
      order = undefined;
    }
    const fallback = describeOrderFallback(order);
    const help = 'The order files are listed in; config and mechanical files go last';
    let title = help;
    if (fallback !== undefined) {
      title = `${fallback}. ${help}`;
    }
    const current = orderModes.find(({ mode }) => mode === requested)?.label ?? 'Path';
    return html`<span class=${fallback === undefined ? '' : 'fell-back'}
      ><beuve-menu label="File order">
        <button
          slot="trigger"
          type="button"
          class="button quiet order-button"
          tabindex="-1"
          aria-label="File order: ${current}"
          title=${title}
        >
          ${displayIcon('sort')}<span>${current}</span>${displayIcon('chevron')}
        </button>
        ${orderModes.map(({ mode, label }) => {
          return html`<button
            type="button"
            role="menuitemradio"
            tabindex="-1"
            aria-checked=${mode === requested ? 'true' : 'false'}
            data-action="order"
            data-mode=${mode}
          >
            ${displayIcon('check')}${label}
          </button>`;
        })}
      </beuve-menu></span
    >`;
  }

  private renderDisplay(display: DiffDisplayView): TemplateResult {
    const label = describeDiffDisplay(display, this.isNarrow);
    const { layout, ignoreWhitespace } = display;
    return html`<span class="tools" role="group" aria-label="Diff display" title=${label.title}>
      <span class="segmented" role="radiogroup" aria-label="Diff layout">
        <button
          type="button"
          role="radio"
          tabindex="-1"
          aria-label="Split"
          title="Split"
          aria-checked=${layout === 'split' ? 'true' : 'false'}
          data-action="layout"
          data-layout="split"
        >
          ${displayIcon('split')}
        </button>
        <button
          class=${layout === 'split' && this.isNarrow ? 'effective' : ''}
          type="button"
          role="radio"
          tabindex="-1"
          aria-label="Inline"
          title="Inline"
          aria-checked=${layout === 'split' ? 'false' : 'true'}
          data-action="layout"
          data-layout="unified"
        >
          ${displayIcon('inline')}
        </button>
      </span>
      <button
        class="button quiet"
        type="button"
        tabindex="-1"
        aria-label="Hide whitespace changes"
        aria-pressed=${ignoreWhitespace ? 'true' : 'false'}
        title=${ignoreWhitespace ? 'Whitespace-only changes are hidden' : 'Hide whitespace-only changes'}
        data-action="whitespace"
      >
        ${displayIcon('whitespace')}
      </button>
    </span>`;
  }

  override render(): TemplateResult | typeof nothing {
    const { display } = this;
    if (display === undefined) {
      return nothing;
    }
    return html`${this.renderOrder(display)}${this.renderDisplay(display)}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-view-controls': BeuveViewControls;
  }
}
