import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type {
  DiffFileView,
  ImpactView,
  RepositoryTreeView,
  SessionSummary,
} from '#contract/ipc-contract.ts';

import './beuve-open-repository-form.ts';
import './beuve-radar-tree.ts';
import type { RadarTreeMode } from './plan-radar-tree.ts';
import { zoneStyles } from './zone-styles.ts';

/**
 * Zone 1: review sessions, the form that opens a local repository, and the radar tree of the open
 * review's files (`f` toggles diff-only); focusing the zone focuses the tree. Requirements mapping arrives later. Emits
 * `beuve-select-session` with `{ sessionId }`; the tree emits `beuve-tree-select`.
 */
@customElement('beuve-intent-sidebar')
export class BeuveIntentSidebar extends LitElement {
  static override styles = [
    zoneStyles,
    css`
      :host {
        border-right: 1px solid var(--beuve-border);
      }

      .body {
        display: flex;
        flex-direction: column;
      }

      .files {
        display: flex;
        flex: 1 0 320px;
        flex-direction: column;
        min-height: 320px;
      }

      .files h2 {
        display: flex;
        align-items: baseline;
        gap: var(--beuve-space-2);
      }

      .files .mode {
        margin-left: auto;
        font-weight: 400;
      }

      beuve-radar-tree {
        flex: 1;
        margin: 0 calc(-1 * var(--beuve-space-3));
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

  /** Tab into Zone 1 lands in the radar tree, so arrow keys work at once. */
  private readonly onFocus = (): void => {
    this.renderRoot.querySelector('beuve-radar-tree')?.focusTree();
  };

  @property({ type: Boolean, reflect: true }) accessor focused = false;
  @property({ attribute: false }) accessor sessions: readonly SessionSummary[] = [];
  @property() accessor selectedId = '';
  /** Shown instead of the list when there are no sessions (or they failed to load). */
  @property() accessor sessionNote = '';
  @property({ type: Boolean }) accessor opening = false;
  @property() accessor openError = '';
  /** The open review's files and the head's tree, for the radar tree. */
  @property({ attribute: false }) accessor files: readonly DiffFileView[] | undefined;
  @property({ attribute: false }) accessor tree: RepositoryTreeView | undefined;
  @property({ attribute: false }) accessor impact: ImpactView | undefined;
  @property() accessor treeMode: RadarTreeMode = 'neighborhood';

  constructor() {
    super();
    this.addEventListener('focus', this.onFocus);
  }

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

  private renderFiles(files: readonly DiffFileView[]): TemplateResult {
    return html`<section class="files">
      <h2>
        Files
        <span class="mode" title="f toggles"
          >${this.treeMode === 'diff-only' ? 'diff only' : 'neighborhood'} · <kbd>f</kbd></span
        >
      </h2>
      <beuve-radar-tree
        .tree=${this.tree}
        .files=${files}
        .impact=${this.impact}
        .mode=${this.treeMode}
      ></beuve-radar-tree>
    </section>`;
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
        ${this.files === undefined ? nothing : this.renderFiles(this.files)}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-intent-sidebar': BeuveIntentSidebar;
  }
}
