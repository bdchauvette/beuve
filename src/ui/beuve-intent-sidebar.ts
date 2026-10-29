import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type {
  DiffFileView,
  ImpactView,
  PullRequestSessionView,
  RepositoryTreeView,
} from '#contract/ipc-contract.ts';

import './beuve-pull-request-intent.ts';
import './beuve-radar-tree.ts';
import type { RadarTreeMode } from './plan-radar-tree.ts';
import { zoneStyles } from './zone-styles.ts';

/**
 * Zone 1: a pull request session's intent (title, body, stack) and the radar tree of the open
 * review's files (`f` toggles diff-only); focusing the zone focuses the tree. No title bar: the
 * content says what it is. Sessions are opened from the open dialog and the palette, not here.
 * Requirements mapping arrives later. The tree emits `beuve-tree-select`, the intent
 * `beuve-open-link` and `beuve-open-stack`.
 */
@customElement('beuve-intent-sidebar')
export class BeuveIntentSidebar extends LitElement {
  static override styles = [
    zoneStyles,
    css`
      .body {
        display: flex;
        flex-direction: column;
      }

      .files {
        position: relative;
        display: flex;
        flex: 1 0 240px;
        flex-direction: column;
        min-height: 240px;
      }

      .mode {
        position: absolute;
        top: -2px;
        right: 0;
        z-index: 1;
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
      }

      beuve-radar-tree {
        flex: 1;
        margin: 0 calc(-1 * var(--beuve-space-3));
      }

      .intent + .files {
        margin-top: var(--beuve-space-3);
        padding-top: var(--beuve-space-3);
        border-top: 1px solid var(--beuve-border);
      }
    `,
  ];

  /** Tab into Zone 1 lands in the radar tree, so arrow keys work at once. */
  private readonly onFocus = (): void => {
    this.renderRoot.querySelector('beuve-radar-tree')?.focusTree();
  };

  @property({ type: Boolean, reflect: true }) accessor focused = false;
  /** The open pull request session's intent; absent for local sessions. */
  @property({ attribute: false }) accessor pullRequest: PullRequestSessionView | undefined;
  /** The open review's files and the head's tree, for the radar tree. */
  @property({ attribute: false }) accessor files: readonly DiffFileView[] | undefined;
  @property({ attribute: false }) accessor tree: RepositoryTreeView | undefined;
  @property({ attribute: false }) accessor impact: ImpactView | undefined;
  @property() accessor treeMode: RadarTreeMode = 'neighborhood';

  constructor() {
    super();
    this.addEventListener('focus', this.onFocus);
  }

  private renderFiles(files: readonly DiffFileView[]): TemplateResult {
    return html`<section class="files">
      <span class="mode" title="f toggles"
        >${this.treeMode === 'diff-only' ? 'changed only' : 'with neighbours'} · <kbd>f</kbd></span
      >
      <beuve-radar-tree
        .tree=${this.tree}
        .files=${files}
        .impact=${this.impact}
        .mode=${this.treeMode}
      ></beuve-radar-tree>
    </section>`;
  }

  /** Shows an unchanged file in the tree (the palette's `@` files). */
  revealPath(path: string): void {
    this.renderRoot.querySelector('beuve-radar-tree')?.revealPath(path);
  }

  override render(): TemplateResult {
    return html`
      <div class="body">
        ${
          this.pullRequest === undefined
            ? nothing
            : html`<section class="intent">
                <beuve-pull-request-intent .view=${this.pullRequest}></beuve-pull-request-intent>
              </section>`
        }
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
