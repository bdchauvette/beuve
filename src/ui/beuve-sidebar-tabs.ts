import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { ActionDelegation } from './action-delegation.ts';
import type { SidebarTab } from './sidebar-tabs-from.ts';
import { sidebarTabsFrom } from './sidebar-tabs-from.ts';
import type { SidebarZone } from './sidebar-zone.ts';
import { focusRingStyles } from './primitives/focus-ring-styles.ts';
import './primitives/beuve-tab-list.ts';

/** A tab was chosen. */
export interface SidebarTabDetail {
  readonly zone: SidebarZone;
}

const zoneIds: ReadonlySet<string> = new Set(['overview', 'files', 'ura', 'chat']);

/**
 * Overview (pull requests only), the files, the review and the chat as quiet tabs (keys 1 to 4). Emits
 * `beuve-sidebar-tab` with the {@link SidebarTabDetail} chosen.
 */
@customElement('beuve-sidebar-tabs')
export class BeuveSidebarTabs extends LitElement {
  static override styles = [
    focusRingStyles,
    css`
      :host {
        display: block;
        flex: none;
      }

      /*
       * The sidebar's part of the title band (ADR 0157): as tall as the title bar beside it, on
       * its background, and it drags the window. On the window's left edge under macOS the owner
       * sets --beuve-sidebar-tabs-inset to leave room for the window buttons.
       */
      beuve-tab-list {
        display: flex;
        gap: var(--beuve-space-4);
        block-size: var(--beuve-titlebar-height);
        padding-inline: var(--beuve-sidebar-tabs-inset, var(--beuve-space-3)) var(--beuve-space-3);
        border-block-end: var(--beuve-border-width) solid var(--beuve-border);
        background: var(--beuve-surface-sunken);
        -webkit-app-region: drag;
        user-select: none;
      }

      button {
        -webkit-app-region: no-drag;
        padding: 0;
        border: none;
        background: none;
        color: var(--beuve-text-muted);
        font: var(--beuve-font-small);
        box-shadow: inset 0 calc(-1 * var(--beuve-border-width-thick)) 0 transparent;
        cursor: pointer;
      }

      button:not([aria-selected='true']):hover {
        color: var(--beuve-text);
      }

      /*
       * The chosen tab says so as the chosen segment of a segmented control does (ADR 0115): accent
       * text over an accent bar along the row's bottom edge.
       */
      button[aria-selected='true'] {
        color: var(--beuve-accent);
        box-shadow: inset 0 calc(-1 * var(--beuve-border-width-thick)) 0 var(--beuve-accent);
      }

      button[aria-selected='true'] .count {
        color: inherit;
      }

      .count {
        margin-inline-start: var(--beuve-space-1);
        color: var(--beuve-text-muted);
      }
    `,
  ];

  private readonly actions = {
    click: {
      choose: ({ tab = '' }): void => {
        if (zoneIds.has(tab)) {
          this.dispatchEvent(
            new CustomEvent<SidebarTabDetail>('beuve-sidebar-tab', {
              detail: { zone: tab as SidebarZone },
              bubbles: true,
              composed: true,
            }),
          );
        }
      },
    },
  };

  /** The tab that is showing. */
  @property() accessor selected: SidebarZone = 'files';

  /** Whether the review is a pull request, which alone has an Overview tab. */
  @property({ type: Boolean }) accessor isPullRequest = false;

  /** How many items the review has staged, shown beside its tab. */
  @property({ type: Number }) accessor stagedCount = 0;

  constructor() {
    super();
    this.addController(new ActionDelegation(this, this.actions));
  }

  private renderTab(tab: SidebarTab): TemplateResult {
    let selected = 'false';
    if (tab.zone === this.selected) {
      selected = 'true';
    }
    return html`<button
      type="button"
      role="tab"
      aria-selected=${selected}
      data-action="choose"
      data-tab=${tab.zone}
    >
      ${tab.label}${tab.count === 0 ? nothing : html`<span class="count">${tab.count}</span>`}
    </button>`;
  }

  protected override render(): TemplateResult {
    return html`<beuve-tab-list label="Sidebar">
      ${sidebarTabsFrom({ isPullRequest: this.isPullRequest, stagedCount: this.stagedCount }).map(
        (tab) => {
          return this.renderTab(tab);
        },
      )}
    </beuve-tab-list>`;
  }
}
