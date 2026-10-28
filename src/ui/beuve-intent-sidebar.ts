import { css, html, LitElement } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { SessionSummary } from '#contract/ipc-contract.ts';

import './beuve-open-repository-form.ts';
import { zoneStyles } from './zone-styles.ts';

/**
 * Zone 1: review sessions and the form that opens a local repository. Requirements mapping and
 * the radar tree arrive in Phase 2. Emits `beuve-select-session` with `{ sessionId }`.
 */
@customElement('beuve-intent-sidebar')
export class BeuveIntentSidebar extends LitElement {
  static override styles = [
    zoneStyles,
    css`
      :host {
        border-right: 1px solid var(--beuve-border);
      }

      ul {
        display: grid;
        gap: 2px;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      button {
        display: grid;
        width: 100%;
        padding: var(--beuve-space-1) var(--beuve-space-2);
        border: 1px solid transparent;
        border-radius: var(--beuve-radius);
        background: none;
        color: var(--beuve-text);
        font: inherit;
        text-align: left;
        cursor: pointer;
      }

      button:hover {
        background: var(--beuve-surface-sunken);
      }

      button[aria-current='true'] {
        border-color: var(--beuve-accent);
        background: var(--beuve-accent-soft);
      }

      .name {
        overflow: hidden;
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .refs {
        overflow: hidden;
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `,
  ];

  @property({ type: Boolean, reflect: true }) accessor focused = false;
  @property({ attribute: false }) accessor sessions: readonly SessionSummary[] = [];
  @property() accessor selectedId = '';
  /** Shown instead of the list when there are no sessions (or they failed to load). */
  @property() accessor sessionNote = '';
  @property({ type: Boolean }) accessor opening = false;
  @property() accessor openError = '';

  private renderSession(session: SessionSummary): TemplateResult {
    const { source } = session;
    const name = source.repoPath.split('/').findLast((part) => part !== '') ?? source.repoPath;
    const head = source.kind === 'local' ? source.headRef : `#${String(source.number)}`;
    return html`
      <li>
        <button
          type="button"
          title=${source.repoPath}
          aria-current=${session.id === this.selectedId ? 'true' : 'false'}
          @click=${(): void => {
            this.select(session.id);
          }}
        >
          <span class="name">${name}</span>
          <span class="refs">${source.baseRef} ← ${head}</span>
        </button>
      </li>
    `;
  }

  private select(sessionId: string): void {
    this.dispatchEvent(
      new CustomEvent('beuve-select-session', {
        detail: { sessionId },
        bubbles: true,
        composed: true,
      }),
    );
  }
  override render(): TemplateResult {
    return html`
      <header>Intent</header>
      <div class="body">
        <section>
          <h2>Sessions</h2>
          ${
            this.sessions.length === 0
              ? html`<p class="empty">${this.sessionNote || 'No sessions yet.'}</p>`
              : html`<ul>
                  ${this.sessions.map((session) => this.renderSession(session))}
                </ul>`
          }
        </section>
        <section>
          <h2>Open local repository</h2>
          <beuve-open-repository-form
            ?busy=${this.opening}
            .error=${this.openError}
          ></beuve-open-repository-form>
        </section>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-intent-sidebar': BeuveIntentSidebar;
  }
}
