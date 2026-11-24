import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import type {
  DiffFileView,
  FileReviewStateView,
  RepositoryTreeView,
} from '#contract/ipc-contract.ts';

import './beuve-radar-tree.ts';
import type { RadarTreeLayout, RadarTreeMode } from './plan-radar-tree.ts';
import { displayIcon } from './display-icon.ts';
import { zoneStyles } from './zone-styles.ts';
import { fieldStyles } from './primitives/field-styles.ts';
import { segmentedStyles } from './primitives/segmented-styles.ts';

/**
 * The Files tab: the radar tree of the open review's files under a header row. The row holds a
 * filter that narrows the listing the tree shows (All or Changed) to the paths containing its
 * terms, the All · Changed toggle (View ▸ Changed Files Only), which emits `beuve-tree-mode
 * { mode }`, and a Tree · Flat toggle for nested folders or one list of full paths. The filter and
 * the layout are this tab's own and are not saved. Focusing the zone focuses the tree, which
 * emits `beuve-tree-select`. Sessions are opened from the open dialog and the
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
    fieldStyles,
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
        flex-wrap: wrap;
        align-items: center;
        gap: var(--beuve-space-1);
        margin-block-end: var(--beuve-space-1);
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
      }

      .filter {
        flex: 1 1 calc(8 * var(--beuve-measure-em));
      }

      beuve-radar-tree {
        flex: 1;
        margin: 0 calc(-1 * var(--beuve-space-3));
      }
    `,
  ];

  /** Focusing the Files zone lands in the radar tree, so arrow keys work at once. */
  private readonly onFocus = (): void => {
    if (this.renderRoot.querySelector('input') === this.shadowRoot?.activeElement) {
      return;
    }
    this.renderRoot.querySelector('beuve-radar-tree')?.focusTree();
  };

  /** Escape clears the filter, then leaves it; Enter and ↓ move into the filtered tree. */
  private readonly onFilterKeyDown = (event: KeyboardEvent): void => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      if (this.query === '') {
        this.renderRoot.querySelector('beuve-radar-tree')?.focusTree();
        return;
      }
      this.query = '';
      return;
    }
    if (event.key !== 'Enter' && event.key !== 'ArrowDown') {
      return;
    }
    event.preventDefault();
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

  /** What the filter field holds. */
  @state() accessor query = '';
  @state() accessor layout: RadarTreeLayout = 'tree';

  constructor() {
    super();
    this.addEventListener('focus', this.onFocus);
  }

  private renderFiles(files: readonly DiffFileView[]): TemplateResult {
    return html`<section class="files">
      <div class="files-header">
        <input
          class="field small filter"
          type="search"
          aria-label=${this.filterLabel()}
          placeholder=${this.filterLabel()}
          spellcheck="false"
          .value=${this.query}
          @input=${(event: Event): void => {
            this.query = (event.target as HTMLInputElement).value;
          }}
          @keydown=${this.onFilterKeyDown}
        />
        <span class="segmented" role="group" aria-label="Files shown">
          ${this.renderMode('neighborhood', {
            label: 'All',
            title: 'Show the changed files with their neighbors',
          })}
          ${this.renderMode('diff-only', { label: 'Changed', title: 'Show changed files only' })}
        </span>
        <span class="segmented" role="group" aria-label="Layout">
          ${this.renderLayout('tree', { label: 'Tree', title: 'Nest files under their folders' })}
          ${this.renderLayout('flat', { label: 'Flat', title: 'List every file by its full path' })}
        </span>
      </div>
      <beuve-radar-tree
        .tree=${this.tree}
        .files=${files}
        .generatedPaths=${this.generatedPaths}
        .reviewMarks=${this.reviewMarks}
        .mode=${this.treeMode}
        .layout=${this.layout}
        .query=${this.query}
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

  private renderLayout(layout: RadarTreeLayout, { label, title }: ButtonText): TemplateResult {
    return html`<button
      type="button"
      title=${title}
      aria-label=${label}
      aria-pressed=${this.layout === layout ? 'true' : 'false'}
      @click=${(): void => {
        this.layout = layout;
      }}
    >
      ${displayIcon(layout)}
    </button>`;
  }

  private filterLabel(): string {
    if (this.treeMode === 'diff-only') {
      return 'Filter changed files';
    }
    return 'Filter all files';
  }

  /** The file focused in the radar tree, which Add to Chat adds whole. */
  focusedPath(): string | undefined {
    return this.renderRoot.querySelector('beuve-radar-tree')?.focusedPath();
  }

  /** Shows an unchanged file in the tree (the palette's `@` files), clearing a filter that hides it. */
  async revealPath(path: string): Promise<void> {
    if (this.query !== '') {
      this.query = '';
      await this.updateComplete;
      await this.renderRoot.querySelector('beuve-radar-tree')?.updateComplete;
    }
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
