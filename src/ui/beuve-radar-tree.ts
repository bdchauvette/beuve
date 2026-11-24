import type * as Trees from '@pierre/trees';
import type {
  FileTree,
  FileTreeLabelsOption,
  FileTreeRowDecoration,
  FileTreeRowDecorationContext,
} from '@pierre/trees';
import { css, html, LitElement } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import type {
  DiffFileView,
  FileReviewStateView,
  RepositoryTreeView,
} from '#contract/ipc-contract.ts';

import { restoreFormatControls } from '#x/text/restore-format-controls.ts';
import { revealFormatControls } from '#x/text/reveal-format-controls.ts';

import { planRadarTree } from './plan-radar-tree.ts';
import type { RadarTreeLayout, RadarTreeMode, RadarTreePlan } from './plan-radar-tree.ts';
import { emptyStateStyles } from './primitives/empty-state-styles.ts';
import { rowDecorationsFrom } from './row-decorations-from.ts';
import type { TreeDecoration } from './tree-decoration.ts';

const trailingSlash = /\/$/u;
/**
 * The tooltips on a row's status letter and a folder's dot. The status is a change in the review,
 * not the working tree's `git status`, and `ignored` marks a generated file (ADR 0026).
 */
const treeLabels: FileTreeLabelsOption = {
  gitStatusTitles: {
    added: 'Added in this review',
    modified: 'Modified in this review',
    deleted: 'Deleted in this review',
    renamed: 'Renamed in this review',
    ignored: 'Generated file',
  },
  containsGitStatusTitle: 'Contains changed files',
};
const planKeys: readonly string[] = [
  'tree',
  'files',
  'mode',
  'layout',
  'query',
  'generatedPaths',
  'reviewMarks',
];

/**
 * The radar tree in Zone 1 (spec section 4, ADR 0026): a `@pierre/trees` view of the repository at
 * the session head that opens the packages a change touches down to its files, marks changed
 * files with their git status, with a `✓` on files marked reviewed (ADR 0064). `mode` is neighborhood or diff-only (View ▸ Changed Files Only). Arrow keys move through
 * the rows; selecting a file (click, Enter or Space) emits `beuve-tree-select` with `{ path }`
 * when that file is part of the review. `query` narrows the listing to paths containing its terms,
 * and the `flat` layout lists every path whole, with no folders.
 *
 * `@pierre/trees` renders each name itself and takes no display hook, so the tree is handed every
 * path with its invisible and bidi characters escaped (`revealFormatControls`, ADR 0082) and maps
 * what it hands back with `restoreFormatControls`; the escape round-trips, so lookups stay exact.
 */
@customElement('beuve-radar-tree')
export class BeuveRadarTree extends LitElement {
  static override styles = [
    emptyStateStyles,
    css`
      :host {
        display: block;
        min-block-size: 0;
      }

      .empty {
        padding: var(--beuve-space-2) var(--beuve-space-3);
      }

      .mount {
        block-size: 100%;
        --trees-bg-override: var(--beuve-surface);
        --trees-fg-override: var(--beuve-text);
        --trees-fg-muted-override: var(--beuve-text-muted);
        --trees-bg-muted-override: var(--beuve-surface-sunken);
        --trees-border-color-override: var(--beuve-border);
        --trees-accent-override: var(--beuve-accent);
        --trees-selected-bg-override: var(--beuve-accent-soft);
        --trees-selected-fg-override: var(--beuve-text);
        --trees-selected-focused-border-color-override: var(--beuve-accent);
        --trees-focus-ring-color-override: var(--beuve-accent);
        --trees-font-family-override: var(--beuve-font-family-sans);
        --trees-font-size-override: var(--beuve-font-size-small);
        --trees-padding-inline-override: 0;
        --trees-git-added-color-override: var(--beuve-ok);
        --trees-git-modified-color-override: var(--beuve-warn);
        --trees-git-deleted-color-override: var(--beuve-danger);
        --trees-git-renamed-color-override: var(--beuve-accent);
        --trees-status-added-override: var(--beuve-ok);
        --trees-status-modified-override: var(--beuve-warn);
        --trees-status-deleted-override: var(--beuve-danger);
        --trees-status-renamed-override: var(--beuve-accent);
      }
    `,
  ];

  private fileTree: FileTree | undefined;
  private plan: RadarTreePlan | undefined;
  /** In the flat layout, each shown name's real path; empty while nested. */
  private readonly realByShown = new Map<string, string>();
  private decorations: ReadonlyMap<string, TreeDecoration> = new Map();
  private readonly reviewed = new Set<string>();

  /** `session:get-tree` for the open session; `undefined` until it answers. */
  @property({ attribute: false }) accessor tree: RepositoryTreeView | undefined;
  @property({ attribute: false }) accessor files: readonly DiffFileView[] = [];
  @property() accessor mode: RadarTreeMode = 'neighborhood';
  @property() accessor layout: RadarTreeLayout = 'tree';
  /** Terms a path must all contain; blank lists everything. */
  @property() accessor query = '';
  /**
   * Generated review files (ADR 0052): their rows take the library's dimmed `ignored` lane
   * instead of their change status; they stay selectable.
   */
  @property({ attribute: false }) accessor generatedPaths: ReadonlySet<string> = new Set();
  /** Reviewed marks by path; a change only redraws the rows' decorations. */
  @property({ attribute: false }) accessor reviewMarks: ReadonlyMap<string, FileReviewStateView> =
    new Map();

  /** `@pierre/trees`, a lazy chunk loaded when the first tree connects. */
  @state() accessor library: typeof Trees | undefined;

  constructor() {
    super();
    this.addController({
      hostConnected: (): void => {
        void this.loadLibrary();
      },
      hostDisconnected: (): void => {
        this.fileTree?.cleanUp();
        this.fileTree = undefined;
        this.plan = undefined;
      },
    });
  }

  private async loadLibrary(): Promise<void> {
    this.library ??= await import('@pierre/trees');
  }

  private mountTree(library: typeof Trees, plan: RadarTreePlan): void {
    const mount = this.renderRoot.querySelector<HTMLElement>('.mount');
    if (mount === null) {
      return;
    }
    this.fileTree = new library.FileTree({
      paths: this.shownPaths(plan.paths),
      initialExpandedPaths: plan.expandedPaths.map((path) => revealFormatControls(path)),
      initialExpansion: 'closed',
      flattenEmptyDirectories: true,
      stickyFolders: true,
      labels: treeLabels,
      gitStatus: this.shownGitStatus(plan.gitStatus),
      renderRowDecoration: (context): FileTreeRowDecoration | null => {
        return this.decorate(context);
      },
      onSelectionChange: (selected): void => {
        this.select(selected);
      },
    });
    this.fileTree.render({ containerWrapper: mount });
  }

  private decorate({ item }: FileTreeRowDecorationContext): FileTreeRowDecoration | null {
    const decoration = this.decorations.get(this.realPath(item.path).replace(trailingSlash, ''));
    if (decoration === undefined) {
      // eslint-disable-next-line unicorn/no-null -- the library's "no decoration" is null.
      return null;
    }
    return { text: decoration.text, title: decoration.title };
  }

  private select(selected: readonly string[]): void {
    const [shown] = selected;
    if (shown === undefined) {
      return;
    }
    const path = this.realPath(shown);
    if (!this.reviewed.has(path)) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent('beuve-tree-select', { detail: { path }, bubbles: true, composed: true }),
    );
  }

  /** `path` as the tree names it: escaped, and with no folders in the flat layout. */
  private shownPath(path: string): string {
    const revealed = revealFormatControls(path);
    if (this.layout === 'flat') {
      // U+29F8 stands in for `/`: the library nests a path at every real one. It is drawn like a
      // slash; U+2215 and U+2044 have side bearings that crowd the neighboring letters.
      return revealed.replaceAll('/', '\u{29F8}');
    }
    return revealed;
  }

  /** What the tree is handed for `paths`; the flat layout also records each name's real path. */
  private shownPaths(paths: readonly string[]): string[] {
    this.realByShown.clear();
    return paths.map((path) => {
      const shown = this.shownPath(path);
      if (this.layout === 'flat') {
        this.realByShown.set(shown, path);
      }
      return shown;
    });
  }

  /** Git status entries keyed by the names the tree shows. */
  private shownGitStatus(entries: RadarTreePlan['gitStatus']): RadarTreePlan['gitStatus'] {
    return entries.map((entry) => {
      return { ...entry, path: this.shownPath(entry.path) };
    });
  }

  /** The real path of a name the tree hands back. */
  private realPath(shown: string): string {
    return this.realByShown.get(shown) ?? restoreFormatControls(shown);
  }

  /** Moves keyboard focus into the tree, on the first changed file when there is one. */
  focusTree(): void {
    const [first] = this.files;
    if (first === undefined) {
      this.fileTree?.focusFirstItem();
      return;
    }
    this.fileTree?.focusPath(this.shownPath(first.path));
  }

  /** The file whose row has keyboard focus, for Add to Chat (ADR 0046); `undefined` on a folder. */
  focusedPath(): string | undefined {
    const shown = this.fileTree?.getFocusedPath() ?? undefined;
    if (shown === undefined || shown.endsWith('/')) {
      return undefined;
    }
    return this.realPath(shown);
  }

  /** Focuses `path`'s row and scrolls it into view, for the palette's unchanged files. */
  revealPath(path: string): void {
    this.fileTree?.scrollToPath(this.shownPath(path));
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    const isStale = planKeys.some((key) => changed.has(key as keyof BeuveRadarTree));
    if (!isStale && this.plan !== undefined) {
      return;
    }
    this.plan = planRadarTree(
      {
        paths: this.tree?.paths ?? [],
        packageRoots: this.tree?.packageRoots ?? [],
        files: this.files,
      },
      this.mode,
      { layout: this.layout, query: this.query },
    );
    this.decorations = rowDecorationsFrom({
      files: this.files,
      marks: this.reviewMarks,
      generated: this.generatedPaths,
    });
    this.reviewed.clear();
    for (const file of this.files) {
      this.reviewed.add(file.path);
    }
  }

  protected override updated(changed: PropertyValues<this>): void {
    const { library, plan } = this;
    if (library === undefined || plan === undefined) {
      return;
    }
    const gitStatus = plan.gitStatus.map((entry) => {
      if (this.generatedPaths.has(entry.path)) {
        return { ...entry, status: 'ignored' as const };
      }
      return entry;
    });
    if (this.fileTree === undefined) {
      this.mountTree(library, { ...plan, gitStatus });
      return;
    }
    const isNewListing = ['tree', 'files', 'mode', 'layout', 'query', 'generatedPaths'].some(
      (key) => {
        return changed.has(key as keyof BeuveRadarTree);
      },
    );
    if (isNewListing) {
      this.fileTree.resetPaths(this.shownPaths(plan.paths), {
        initialExpandedPaths: plan.expandedPaths.map((path) => revealFormatControls(path)),
      });
      this.fileTree.setGitStatus(this.shownGitStatus(gitStatus));
    }
    if (changed.has('reviewMarks') || changed.has('files') || changed.has('generatedPaths')) {
      // Re-renders the rows, so they ask `renderRowDecoration` again.
      this.fileTree.setComposition(this.fileTree.getComposition());
    }
  }

  override render(): TemplateResult {
    const isUnmatched = this.plan?.paths.length === 0 && this.query.trim() !== '';
    return html`<p class="empty" role="status" ?hidden=${!isUnmatched}>No files match.</p>
      <div class="mount"></div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-radar-tree': BeuveRadarTree;
  }
}
