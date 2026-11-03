import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { ActionDelegation } from './action-delegation.ts';
import type { SidebarTab } from './sidebar-tabs-from.ts';
import { sidebarTabsFrom } from './sidebar-tabs-from.ts';
import type { SidebarZone } from './sidebar-zone.ts';

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
  static override styles = css`
    :host {
      display: block;
      flex: none;
    }

    nav {
      display: flex;
      gap: var(--beuve-space-4);
      height: 30px;
      padding: 0 var(--beuve-space-3);
      border-bottom: 1px solid var(--beuve-border);
    }

    button {
      padding: 0;
      border: none;
      background: none;
      color: var(--beuve-text-muted);
      font: var(--beuve-font-small);
      box-shadow: inset 0 -2px 0 transparent;
      cursor: pointer;
    }

    button[aria-selected='true'] {
      color: var(--beuve-text);
      box-shadow: inset 0 -2px 0 var(--beuve-border);
    }

    .count {
      margin-left: 3px;
      color: var(--beuve-text-muted);
    }
  `;

  private readonly actions = {
    click: {
      choose: ({ zone = '' }): void => {
        if (zoneIds.has(zone)) {
          this.dispatchEvent(
            new CustomEvent<SidebarTabDetail>('beuve-sidebar-tab', {
              detail: { zone: zone as SidebarZone },
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
      data-zone=${tab.zone}
    >
      ${tab.label}${tab.count === 0 ? nothing : html`<span class="count">${tab.count}</span>`}
    </button>`;
  }

  protected override render(): TemplateResult {
    return html`<nav role="tablist" aria-label="Sidebar">
      ${sidebarTabsFrom({ isPullRequest: this.isPullRequest, stagedCount: this.stagedCount }).map(
        (tab) => {
          return this.renderTab(tab);
        },
      )}
    </nav>`;
  }
}
