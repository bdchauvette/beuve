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
        align-items: stretch;
        block-size: var(--beuve-titlebar-height);
        padding-inline-start: var(--beuve-sidebar-tabs-inset, 0);
        border-block-end: var(--beuve-border-width) solid var(--beuve-border);
        background: var(--beuve-surface-sunken);
        -webkit-app-region: drag;
        user-select: none;
      }

      /*
       * Tabs fill the band's height, so the chosen one's full-height lines match the title bar's
       * section lines (ADR 0157 amendment). Each reaches over the band's bottom border, so the
       * chosen one's bar sits on the band's very bottom edge, against the panel's own focus line.
       */
      button {
        position: relative;
        margin-block-end: calc(-1 * var(--beuve-border-width));
        padding: 0 var(--beuve-space-3);
        border: none;
        border-inline: var(--beuve-border-width) solid transparent;
        background: none;
        color: var(--beuve-text-muted);
        font: var(--beuve-font-small);
        cursor: pointer;
        -webkit-app-region: no-drag;
      }

      /* The first tab's start line lies over the sidebar's own edge rather than beside it. */
      button:first-child {
        margin-inline-start: calc(-1 * var(--beuve-border-width));
      }

      button:not([aria-selected='true']):hover {
        color: var(--beuve-text);
      }

      /*
       * The chosen tab is open onto the panel below: full-height lines on both sides, the panel's
       * background, accent text, and an accent bar along the band's bottom edge (as the chosen
       * segment of a segmented control has, ADR 0115).
       */
      button[aria-selected='true'] {
        border-inline-color: var(--beuve-border);
        background: var(--beuve-surface);
        color: var(--beuve-accent);
      }

      button[aria-selected='true']::after {
        content: '';
        position: absolute;
        inset-inline: calc(-1 * var(--beuve-border-width));
        inset-block-end: 0;
        block-size: var(--beuve-border-width-thick);
        background: var(--beuve-accent);
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
