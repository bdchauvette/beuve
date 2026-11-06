import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type {
  DiffFileView,
  FileReviewStateView,
  RepositoryTreeView,
} from '#contract/ipc-contract.ts';

import './beuve-radar-tree.ts';
import type { RadarTreeMode } from './plan-radar-tree.ts';
import { zoneStyles } from './zone-styles.ts';
import { segmentedStyles } from './primitives/segmented-styles.ts';

/**
 * The Files tab: the radar tree of the open review's files under a header row whose All · Changed
 * toggle (View ▸ Changed Files Only) emits `beuve-tree-mode { mode }`; focusing the zone focuses
 * the tree, which emits `beuve-tree-select`. Sessions are opened from the open dialog and the
 * palette, not here. A pull request's description and checks are in the Overview tab (ADR 0109).
 */
/** A toggle button's label and its tooltip. */
interface ButtonText {
  readonly label: string;
  readonly title: string;
}

@customElement('beuve-files-sidebar')
export class BeuveFilesSidebar extends LitElement {
  static override styles = [
    segmentedStyles,
    zoneStyles,
    css`
      .body {
        display: flex;
        flex-direction: column;
      }

      .files {
        position: relative;
        display: flex;
        flex: 1 0 var(--beuve-size-scroll);
        flex-direction: column;
        min-block-size: var(--beuve-size-scroll);
      }

      .files-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        min-block-size: var(--beuve-size-control-small);
        margin-block-end: var(--beuve-space-1);
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
      }

      beuve-radar-tree {
        flex: 1;
        margin: 0 calc(-1 * var(--beuve-space-3));
      }
    `,
  ];

  /** Focusing the Files zone lands in the radar tree, so arrow keys work at once. */
  private readonly onFocus = (): void => {
    this.renderRoot.querySelector('beuve-radar-tree')?.focusTree();
  };

  @property({ type: Boolean, reflect: true }) accessor focused = false;
  /** The open review's files and the head's tree, for the radar tree. */
  @property({ attribute: false }) accessor files: readonly DiffFileView[] | undefined;
  @property({ attribute: false }) accessor tree: RepositoryTreeView | undefined;
  /** Generated review files, dimmed in the tree (ADR 0052). */
  @property({ attribute: false }) accessor generatedPaths: ReadonlySet<string> = new Set();
  @property() accessor treeMode: RadarTreeMode = 'neighborhood';
  /** Reviewed marks by path (ADR 0064), shown on the tree's rows. */
  @property({ attribute: false }) accessor reviewMarks: ReadonlyMap<string, FileReviewStateView> =
    new Map();

  constructor() {
    super();
    this.addEventListener('focus', this.onFocus);
  }

  private renderFiles(files: readonly DiffFileView[]): TemplateResult {
    return html`<section class="files">
      <div class="files-header">
        <span>Files</span>
        <span class="segmented" role="group" aria-label="Files shown">
          ${this.renderMode('neighborhood', {
            label: 'All',
            title: 'Show the changed files with their neighbours',
          })}
          ${this.renderMode('diff-only', { label: 'Changed', title: 'Show changed files only' })}
        </span>
      </div>
      <beuve-radar-tree
        .tree=${this.tree}
        .files=${files}
        .generatedPaths=${this.generatedPaths}
        .reviewMarks=${this.reviewMarks}
        .mode=${this.treeMode}
      ></beuve-radar-tree>
    </section>`;
  }

  private renderMode(mode: RadarTreeMode, { label, title }: ButtonText): TemplateResult {
    return html`<button
      type="button"
      title=${title}
      aria-pressed=${this.treeMode === mode ? 'true' : 'false'}
      @click=${(): void => {
        this.dispatchEvent(
          new CustomEvent('beuve-tree-mode', { detail: { mode }, bubbles: true, composed: true }),
        );
      }}
    >
      ${label}
    </button>`;
  }

  /** The file focused in the radar tree, which Add to Chat adds whole. */
  focusedPath(): string | undefined {
    return this.renderRoot.querySelector('beuve-radar-tree')?.focusedPath();
  }

  /** Shows an unchanged file in the tree (the palette's `@` files). */
  revealPath(path: string): void {
    this.renderRoot.querySelector('beuve-radar-tree')?.revealPath(path);
  }

  override render(): TemplateResult {
    return html`<div class="body">
      ${this.files === undefined ? nothing : this.renderFiles(this.files)}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-files-sidebar': BeuveFilesSidebar;
  }
}
