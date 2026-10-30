import { css, html, LitElement } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import './flow-graph-view.ts';
import type { FlowState } from './flow-state.ts';

/**
 * The control-flow portal (spec 5D, Show Control Flow): a heading and the function's flowchart in the
 * inline area of a file card, where the call-stack peek also lives. Presentational: errors and
 * loading are text, `flow-node-activate` bubbles up from the chart, and the owner closes it.
 * Focus moves into the chart when it appears, so the arrow keys work at once.
 */
@customElement('beuve-flow-portal')
export class BeuveFlowPortal extends LitElement {
  static override styles = css`
    :host {
      display: block;
      border-bottom: 1px solid var(--beuve-border);
      background: var(--beuve-bg);
      font: var(--beuve-font-small);
    }

    .close,
    .again {
      padding: 0 var(--beuve-space-1);
      border: none;
      background: none;
      color: var(--beuve-text-muted);
      font: inherit;
      cursor: pointer;
    }

    .close {
      font-size: 15px;
      line-height: 1;
    }

    .heading {
      display: flex;
      align-items: baseline;
      gap: var(--beuve-space-2);
      padding: var(--beuve-space-2) var(--beuve-space-3) var(--beuve-space-1);
      color: var(--beuve-text-muted);
    }

    .heading code {
      font: var(--beuve-font-mono);
      color: var(--beuve-text);
    }

    .spacer {
      flex: 1;
    }

    beuve-flow-graph {
      max-height: 60vh;
      padding: 0 var(--beuve-space-3) var(--beuve-space-2);
    }

    .note {
      margin: 0;
      padding: 2px var(--beuve-space-3) var(--beuve-space-2);
      color: var(--beuve-text-muted);
    }

    .note.error {
      color: var(--beuve-danger);
    }

    kbd {
      padding: 0 var(--beuve-space-1);
      border: 1px solid var(--beuve-border);
      border-bottom-width: 2px;
      border-radius: 4px;
      background: var(--beuve-surface-sunken);
      font: var(--beuve-font-mono);
      font-size: 10px;
    }
  `;

  @property({ attribute: false }) accessor flow: FlowState | undefined;

  private renderBody(flow: FlowState): TemplateResult {
    switch (flow.status) {
      case 'loading': {
        return html`<p class="note">Reading the function…</p>`;
      }
      case 'error': {
        return html`<p class="note error">${flow.message}</p>`;
      }
      case 'ready': {
        return html`<beuve-flow-graph .graph=${flow.graph}></beuve-flow-graph>`;
      }
    }
  }

  protected override updated(changed: PropertyValues<this>): void {
    const previous = changed.get('flow');
    if (this.flow?.status === 'ready' && previous?.status !== 'ready') {
      this.renderRoot.querySelector('beuve-flow-graph')?.focusEntry();
    }
  }

  override render(): TemplateResult {
    const { flow } = this;
    if (flow === undefined) {
      return html``;
    }
    const target =
      flow.status === 'ready' && flow.graph.name !== ''
        ? html`<code>${flow.graph.name}</code>`
        : 'the function';
    return html`
      <div class="heading" role="heading" aria-level="3">
        <span>Control flow of ${target}</span>
        <span class="spacer"></span>
        <button
          type="button"
          class="close"
          title="Close (Esc)"
          aria-label="Close"
          @click=${(): void => {
            this.dispatchEvent(
              new CustomEvent('beuve-flow-close', { bubbles: true, composed: true }),
            );
          }}
        >
          ×
        </button>
      </div>
      ${this.renderBody(flow)}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-flow-portal': BeuveFlowPortal;
  }
}
