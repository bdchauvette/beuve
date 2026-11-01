import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { TrustView } from '#contract/ipc-contract.ts';

import { ActionDelegation } from './action-delegation.ts';
import { formatControlStyles } from './format-control-styles.ts';
import { pathText } from './path-text.ts';
import { trustGrantWording } from './trust-grant-wording.ts';

/** What the reviewer chose in the trust prompt. */
export interface TrustDialogChoice {
  readonly action: 'trust' | 'close';
}

/**
 * The trust prompt (ADR 0090), as a modal panel for the session's repository. Focus starts on
 * Cancel (ADR 0041) and Escape closes it. The choice leaves as a `beuve-trust-choice` event;
 * paths are revealed (ADR 0082).
 */
@customElement('beuve-trust-dialog')
export class BeuveTrustDialog extends LitElement {
  static override styles = [
    formatControlStyles,
    css`
      :host {
        display: block;
        color: var(--beuve-text);
        font: var(--beuve-font-body, inherit);
      }

      h3 {
        margin: 0 0 var(--beuve-space-3);
        font-size: 1.05em;
      }

      p {
        margin: 0 0 var(--beuve-space-3);
        line-height: 1.45;
      }

      code {
        font: var(--beuve-font-mono, monospace);
      }

      .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--beuve-space-2);
      }

      .actions button {
        padding: var(--beuve-space-1) var(--beuve-space-3);
        border: 1px solid var(--beuve-border);
        border-radius: 6px;
        background: var(--beuve-surface);
        color: var(--beuve-text);
        font: inherit;
        cursor: pointer;
      }

      .actions button.primary {
        border-color: var(--beuve-accent);
        background: var(--beuve-accent);
        color: var(--beuve-on-accent, #fff);
      }
    `,
  ];

  @property({ attribute: false }) accessor trust: TrustView | undefined;

  constructor() {
    super();
    // ADR 0074: every button through one listener.
    this.addController(
      new ActionDelegation(this, {
        click: {
          choose: ({ choice = 'close' }): void => {
            this.choose(choice);
          },
        },
        keydown: {
          dialog: (_data, event): void => {
            if (event.key !== 'Escape') {
              return;
            }
            event.preventDefault();
            this.choose('close');
          },
        },
      }),
    );
  }

  private choose(choice: string): void {
    const detail: TrustDialogChoice = { action: choiceOf(choice) };
    this.dispatchEvent(
      new CustomEvent('beuve-trust-choice', { detail, bubbles: true, composed: true }),
    );
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has('trust')) {
      this.renderRoot.querySelector<HTMLButtonElement>('[data-cancel]')?.focus();
    }
  }

  override render(): TemplateResult | typeof nothing {
    const { trust } = this;
    if (trust === undefined) {
      return nothing;
    }
    return html`<div role="dialog" aria-labelledby="trust-title" data-action="dialog">
      <h3 id="trust-title">Trust this repository?</h3>
      <p>
        <code title=${trust.repositoryPath}>${pathText(trust.repositoryPath)}</code>${
          trust.remoteUrl === undefined
            ? nothing
            : html` · origin <code title=${trust.remoteUrl}>${pathText(trust.remoteUrl)}</code>`
        }
      </p>
      <p>${trustGrantWording}</p>
      <div class="actions">
        <button type="button" data-action="choose" data-choice="close" data-cancel>Cancel</button>
        <button type="button" class="primary" data-action="choose" data-choice="trust">
          Trust
        </button>
      </div>
    </div>`;
  }
}

function choiceOf(value: string): TrustDialogChoice['action'] {
  if (value === 'trust') {
    return 'trust';
  }
  return 'close';
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-trust-dialog': BeuveTrustDialog;
  }
}
