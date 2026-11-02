import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { ActionDelegation } from './action-delegation.ts';
import type { SidebarZone } from './sidebar-zone.ts';

interface Tab {
  readonly zone: SidebarZone;
  readonly label: string;
  readonly count: number;
}

/** A tab was chosen. */
export interface SidebarTabDetail {
  readonly zone: SidebarZone;
}

const zoneIds: ReadonlySet<string> = new Set(['intent', 'ura', 'chat']);

/**
 * Intent and files, the review and the chat as three quiet tabs (keys 1, 2 and 3). Emits
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
  @property() accessor selected: SidebarZone = 'intent';

  /** Whether the review is a pull request, which the first tab then calls Intent & files. */
  @property({ type: Boolean }) accessor isPullRequest = false;

  /** How many items the review has staged, shown beside its tab. */
  @property({ type: Number }) accessor stagedCount = 0;

  constructor() {
    super();
    this.addController(new ActionDelegation(this, this.actions));
  }

  private tabs(): readonly Tab[] {
    let first = 'Files';
    if (this.isPullRequest) {
      first = 'Intent & files';
    }
    return [
      { zone: 'intent', label: first, count: 0 },
      { zone: 'ura', label: 'Review', count: this.stagedCount },
      { zone: 'chat', label: 'Chat', count: 0 },
    ];
  }

  private renderTab(tab: Tab): TemplateResult {
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
      ${this.tabs().map((tab) => this.renderTab(tab))}
    </nav>`;
  }
}
