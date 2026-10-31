import type * as Trees from '@pierre/trees';
import type { FileTree, FileTreeRowDecoration, FileTreeRowDecorationContext } from '@pierre/trees';
import { css, html, LitElement } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import type {
  DiffFileView,
  FileReviewStateView,
  ImpactView,
  RepositoryTreeView,
} from '#contract/ipc-contract.ts';

import { restoreFormatControls } from '#x/text/restore-format-controls.ts';
import { revealFormatControls } from '#x/text/reveal-format-controls.ts';

import { planRadarTree } from './plan-radar-tree.ts';
import type { RadarTreeMode, RadarTreePlan } from './plan-radar-tree.ts';
import { planTreeDecorations } from './plan-tree-decorations.ts';
import type { TreeDecoration } from './plan-tree-decorations.ts';
import { withReviewedDecorations } from './with-reviewed-decorations.ts';

const trailingSlash = /\/$/u;

/**
 * The radar tree in Zone 1 (spec section 4, ADR 0026): a `@pierre/trees` view of the repository at
 * the session head that opens the packages a change touches down to its files, marks changed
 * files with their git status, and puts ImpactGate percentiles and finding counts on changed
 * files and their packages, with a `✓` on files marked reviewed (ADR 0064). `mode` is neighborhood or diff-only (View ▸ Changed Files Only). Arrow keys move through
 * the rows; selecting a file (click, Enter or Space) emits `beuve-tree-select` with `{ path }`
 * when that file is part of the review.
 *
 * `@pierre/trees` renders each name itself and takes no display hook, so the tree is handed every
 * path with its invisible and bidi characters escaped (`revealFormatControls`, ADR 0082) and maps
 * what it hands back with `restoreFormatControls`; the escape round-trips, so lookups stay exact.
 */
@customElement('beuve-radar-tree')
export class BeuveRadarTree extends LitElement {
  static override styles = css`
    :host {
      display: block;
      min-height: 0;
    }

    .mount {
      height: 100%;
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
      --trees-font-family-override: system-ui, -apple-system, 'Segoe UI', sans-serif;
      --trees-font-size-override: 12px;
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
  `;

  private fileTree: FileTree | undefined;
  private plan: RadarTreePlan | undefined;
  private decorations: ReadonlyMap<string, TreeDecoration> = new Map();
  private readonly reviewed = new Set<string>();

  /** `session:get-tree` for the open session; `undefined` until it answers. */
  @property({ attribute: false }) accessor tree: RepositoryTreeView | undefined;
  @property({ attribute: false }) accessor files: readonly DiffFileView[] = [];
  @property({ attribute: false }) accessor impact: ImpactView | undefined;
  @property() accessor mode: RadarTreeMode = 'neighborhood';
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
      paths: plan.paths.map((path) => revealFormatControls(path)),
      initialExpandedPaths: plan.expandedPaths.map((path) => revealFormatControls(path)),
      initialExpansion: 'closed',
      flattenEmptyDirectories: true,
      stickyFolders: true,
      gitStatus: shownGitStatus(plan.gitStatus),
      renderRowDecoration: (context): FileTreeRowDecoration | null => this.decorate(context),
      onSelectionChange: (selected): void => {
        this.select(selected);
      },
    });
    this.fileTree.render({ containerWrapper: mount });
  }

  private decorate({ item }: FileTreeRowDecorationContext): FileTreeRowDecoration | null {
    const decoration = this.decorations.get(
      restoreFormatControls(item.path).replace(trailingSlash, ''),
    );
    // eslint-disable-next-line unicorn/no-null -- the library's "no decoration" is null.
    return decoration === undefined ? null : { text: decoration.text, title: decoration.title };
  }

  private select(selected: readonly string[]): void {
    const [shown] = selected;
    const path = shown === undefined ? undefined : restoreFormatControls(shown);
    if (path === undefined || !this.reviewed.has(path)) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent('beuve-tree-select', { detail: { path }, bubbles: true, composed: true }),
    );
  }

  /** Moves keyboard focus into the tree, on the first changed file when there is one. */
  focusTree(): void {
    const [first] = this.files;
    if (first === undefined) {
      this.fileTree?.focusFirstItem();
      return;
    }
    this.fileTree?.focusPath(revealFormatControls(first.path));
  }

  /** The file whose row has keyboard focus, for Add to Chat (ADR 0046); `undefined` on a folder. */
  focusedPath(): string | undefined {
    const shown = this.fileTree?.getFocusedPath() ?? undefined;
    return shown === undefined || shown.endsWith('/') ? undefined : restoreFormatControls(shown);
  }

  /** Focuses `path`'s row and scrolls it into view, for the palette's unchanged files. */
  revealPath(path: string): void {
    this.fileTree?.scrollToPath(revealFormatControls(path));
  }

  protected override updated(changed: PropertyValues<this>): void {
    const { library } = this;
    const isRelevant = [
      'tree',
      'files',
      'mode',
      'impact',
      'library',
      'generatedPaths',
      'reviewMarks',
    ].some((key) => changed.has(key as keyof BeuveRadarTree));
    if (library === undefined || !isRelevant) {
      return;
    }
    const plan = planRadarTree(
      {
        paths: this.tree?.paths ?? [],
        packageRoots: this.tree?.packageRoots ?? [],
        files: this.files,
      },
      this.mode,
    );
    this.decorations = withReviewedDecorations(
      planTreeDecorations(this.impact, plan.packageOf),
      this.reviewMarks,
    );
    const gitStatus = plan.gitStatus.map((entry) =>
      this.generatedPaths.has(entry.path) ? { ...entry, status: 'ignored' as const } : entry,
    );
    this.reviewed.clear();
    for (const file of this.files) {
      this.reviewed.add(file.path);
    }
    const isNewListing =
      this.plan === undefined ||
      changed.has('tree') ||
      changed.has('files') ||
      changed.has('mode') ||
      changed.has('generatedPaths');
    this.plan = plan;
    if (this.fileTree === undefined) {
      this.mountTree(library, { ...plan, gitStatus });
      return;
    }
    if (isNewListing) {
      this.fileTree.resetPaths(
        plan.paths.map((path) => revealFormatControls(path)),
        { initialExpandedPaths: plan.expandedPaths.map((path) => revealFormatControls(path)) },
      );
      this.fileTree.setGitStatus(shownGitStatus(gitStatus));
    }
    if (changed.has('impact') || changed.has('reviewMarks')) {
      // Re-renders the rows, so they ask `renderRowDecoration` again.
      this.fileTree.setComposition(this.fileTree.getComposition());
    }
  }

  override render(): TemplateResult {
    return html`<div class="mount"></div>`;
  }
}

/** Git status entries keyed by the paths the tree shows. */
function shownGitStatus(entries: RadarTreePlan['gitStatus']): RadarTreePlan['gitStatus'] {
  return entries.map((entry) => ({ ...entry, path: revealFormatControls(entry.path) }));
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-radar-tree': BeuveRadarTree;
  }
}
