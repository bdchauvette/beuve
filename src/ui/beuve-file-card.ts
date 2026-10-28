import type * as Diffs from '@pierre/diffs';
import type { FileDiff, FileDiffLoadedFiles, FileDiffMetadata } from '@pierre/diffs';
import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import type {
  AgentInsightView,
  DiffFileView,
  FileImpactView,
  FilePairView,
  ImpactFindingView,
} from '#contract/ipc-contract.ts';

import './beuve-agent-insight.ts';
import type { BeuveAgentInsight } from './beuve-agent-insight.ts';
import './beuve-peek-portal.ts';
import { describeFileImpact } from './describe-file-impact.ts';
import { highlightedLanguages } from './highlighted-languages.ts';
import type { PeekState } from './peek-state.ts';
import { placeInsights } from './place-insights.ts';
import { planHunkSteps } from './plan-hunk-steps.ts';
import { splitPatch } from './split-patch.ts';
import { syntaxPalettes } from './syntax-palettes.ts';
import { toInsightAnnotations } from './to-insight-annotations.ts';
import { toTextmateTheme } from './to-textmate-theme.ts';
import type { TextmateTheme } from './to-textmate-theme.ts';

/** Reads both sides of a reviewed file for hunk expansion; `undefined` when it can't. */
export type FilePairLoader = (path: string) => Promise<FilePairView | undefined>;

const themeNames = { light: 'beuve-light', dark: 'beuve-dark' } as const;
const estimatedLineHeight = 20;
const estimatedSeparatorHeight = 32;

/**
 * One file of the review diff (ADR 0018, 0025): a header with its status, path and line counts,
 * the ImpactGate banner once the impact check has run, the call-stack peek portal while it is
 * open, and the patch rendered by `@pierre/diffs` with Alabaster-style highlighting and agent
 * insights as line annotations. The diff mounts while the stream sets `mounted` (the card is near
 * the viewport); otherwise a placeholder of the diff's last or estimated height stands in. If the
 * library fails to render, the card falls back to a plain `<pre>` of the patch. Emits
 * `beuve-diff-rendered` each time its diff mounts.
 */
@customElement('beuve-file-card')
export class BeuveFileCard extends LitElement {
  static override styles = css`
    :host {
      display: block;
      border: 1px solid var(--beuve-border);
      border-radius: var(--beuve-radius);
      background: var(--beuve-code-bg);
      overflow: clip;
    }

    :host([active]) {
      border-color: var(--beuve-accent);
      box-shadow: 0 0 0 1px var(--beuve-accent);
    }

    .header {
      position: sticky;
      top: calc(-1 * var(--beuve-space-3));
      z-index: 2;
    }

    .title {
      display: flex;
      align-items: center;
      gap: var(--beuve-space-2);
      padding: var(--beuve-space-2) var(--beuve-space-3);
      border-bottom: 1px solid var(--beuve-border);
      background: var(--beuve-surface-sunken);
    }

    .path {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      font: var(--beuve-font-mono);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .old-path {
      color: var(--beuve-text-muted);
    }

    .status {
      padding: 0 var(--beuve-space-1);
      border: 1px solid var(--beuve-border);
      border-radius: 4px;
      font: var(--beuve-font-small);
      color: var(--beuve-text-muted);
      text-transform: uppercase;
    }

    .additions {
      font: var(--beuve-font-mono);
      color: var(--beuve-diff-added-text);
    }

    .deletions {
      font: var(--beuve-font-mono);
      color: var(--beuve-diff-removed-text);
    }

    .impact {
      padding: var(--beuve-space-1) var(--beuve-space-3);
      border-bottom: 1px solid var(--beuve-border);
      background: var(--beuve-surface);
      font: var(--beuve-font-small);
      color: var(--beuve-text-muted);
    }

    .impact.warning {
      background: color-mix(in srgb, var(--beuve-warn) 12%, var(--beuve-surface));
      color: var(--beuve-warn);
    }

    .impact .label {
      font-weight: 600;
    }

    .placeholder {
      background: var(--beuve-code-bg);
    }

    .empty {
      margin: 0;
      padding: var(--beuve-space-2) var(--beuve-space-3);
      font: var(--beuve-font-small);
      color: var(--beuve-text-muted);
    }

    diffs-container {
      --diffs-font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
      --diffs-font-size: 12px;
      --diffs-line-height: 20px;
      --diffs-header-font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
      --diffs-bg-context-override: var(--beuve-code-bg);
      --diffs-bg-buffer-override: var(--beuve-code-bg);
      --diffs-bg-separator-override: var(--beuve-surface-sunken);
      --diffs-bg-context-gutter-override: var(--beuve-code-bg);
      --diffs-fg-number-override: var(--beuve-text-muted);
      --diffs-bg-addition-override: var(--beuve-diff-added-bg);
      --diffs-bg-addition-number-override: var(--beuve-diff-added-bg);
      --diffs-bg-addition-emphasis-override: var(--beuve-diff-added-emphasis);
      --diffs-bg-deletion-override: var(--beuve-diff-removed-bg);
      --diffs-bg-deletion-number-override: var(--beuve-diff-removed-bg);
      --diffs-bg-deletion-emphasis-override: var(--beuve-diff-removed-emphasis);
      --diffs-addition-color-override: var(--beuve-diff-added-bar);
      --diffs-deletion-color-override: var(--beuve-diff-removed-bar);
      --diffs-bg-selection-override: var(--beuve-accent-soft);
      --diffs-bg-selection-number-override: var(--beuve-accent-soft);
      --diffs-selection-color-override: var(--beuve-accent);
      --diffs-bg-hover-override: var(--beuve-surface-sunken);
    }

    beuve-agent-insight {
      margin: var(--beuve-space-1) var(--beuve-space-3) var(--beuve-space-2);
    }

    pre {
      margin: 0;
      padding: var(--beuve-space-1) 0;
      overflow-x: auto;
      font: var(--beuve-font-mono);
    }

    .line {
      display: block;
      min-width: max-content;
      padding: 0 var(--beuve-space-3);
    }

    .line.added {
      background: var(--beuve-diff-added-bg);
    }

    .line.removed {
      background: var(--beuve-diff-removed-bg);
    }

    .line.hunk,
    .line.meta,
    .line.note {
      color: var(--beuve-text-muted);
    }
  `;

  private diff: FileDiff<AgentInsightView> | undefined;
  private metadata: FileDiffMetadata | undefined;
  /** The diff's rendered height when it last unmounted, for an exact placeholder. */
  private measuredHeight: number | undefined;
  private readonly insightElements = new Map<string, BeuveAgentInsight>();

  @property({ attribute: false }) accessor file: DiffFileView | undefined;
  @property({ type: Boolean, reflect: true }) accessor active = false;
  /** Set by the diff stream when the card nears the viewport; the diff renders from then on. */
  @property({ type: Boolean, reflect: true }) accessor mounted = false;
  /** This file's ImpactGate entry; `undefined` until the check has run. */
  @property({ attribute: false }) accessor impact: FileImpactView | undefined;
  @property({ attribute: false }) accessor findings: readonly ImpactFindingView[] = [];
  @property({ attribute: false }) accessor peek: PeekState | undefined;
  /** This file's agent insights for the reviewed head. */
  @property({ attribute: false }) accessor insights: readonly AgentInsightView[] = [];
  @property() accessor focusedInsightId: string | undefined;
  /** The hunk `j`/`k` stopped at, selected in the diff; `-1` for none. */
  @property({ type: Number }) accessor activeHunk = -1;
  /** Enables hunk expansion; absent outside Electron. */
  @property({ attribute: false }) accessor loadFilePair: FilePairLoader | undefined;

  @state() accessor isFallback = false;
  /** `@pierre/diffs`, loaded with the first card that mounts (ADR 0025). */
  @state() accessor library: typeof Diffs | undefined;

  constructor() {
    super();
    this.addController({
      hostDisconnected: (): void => {
        this.diff?.cleanUp();
        this.diff = undefined;
      },
    });
  }

  private findRow(side: 'additions' | 'deletions', line: number): Element | undefined {
    const root = this.renderRoot.querySelector('diffs-container')?.shadowRoot;
    const type = side === 'additions' ? 'change-addition' : 'change-deletion';
    return (
      root?.querySelector(
        `[data-line='${CSS.escape(String(line))}'][data-line-type='${CSS.escape(type)}']`,
      ) ?? undefined
    );
  }

  private async loadLibrary(): Promise<void> {
    try {
      this.library = await loadDiffs();
    } catch {
      this.isFallback = true;
    }
  }

  private syncDiff(
    library: typeof Diffs,
    changed: PropertyValues<this>,
    container: HTMLElement,
    metadata: FileDiffMetadata,
  ): void {
    const isNew = this.diff === undefined;
    this.diff ??= this.createDiff(library);
    const annotations = toInsightAnnotations(this.file?.hunks ?? [], this.insights);
    const isNewInput = ['file', 'mounted', 'library', 'insights'].some((key) =>
      changed.has(key as keyof BeuveFileCard),
    );
    if (isNew || isNewInput) {
      this.diff.render({
        fileDiff: metadata,
        containerWrapper: container,
        lineAnnotations: annotations,
      });
    }
    if (changed.has('focusedInsightId') || changed.has('insights')) {
      for (const [id, element] of this.insightElements) {
        element.focused = id === this.focusedInsightId;
      }
    }
    if (!isNew && !changed.has('activeHunk') && !changed.has('active')) {
      return;
    }
    const step = this.active ? planHunkSteps(metadata.hunks)[this.activeHunk] : undefined;
    // eslint-disable-next-line unicorn/no-null -- the library clears the selection with null.
    this.diff.setSelectedLines(step ?? null);
  }

  private createDiff(library: typeof Diffs): FileDiff<AgentInsightView> {
    registerThemes(library);
    const loader = this.loadFilePair;
    return new library.FileDiff<AgentInsightView>({
      theme: themeNames,
      themeType: 'system',
      preferredHighlighter: 'shiki-js',
      diffStyle: 'unified',
      disableFileHeader: true,
      hunkSeparators: 'line-info',
      lineDiffType: 'word-alt',
      overflow: 'scroll',
      ...(loader !== undefined && {
        loadDiffFiles: async (fileDiff: FileDiffMetadata): Promise<FileDiffLoadedFiles> =>
          loadFiles(loader, fileDiff),
      }),
      renderAnnotation: (annotation): HTMLElement => this.insightElement(annotation.metadata),
      onPostRender: (_node, _instance, phase): void => {
        if (phase === 'mount') {
          this.dispatchEvent(
            new CustomEvent('beuve-diff-rendered', { bubbles: true, composed: true }),
          );
        }
      },
    });
  }

  private insightElement(insight: AgentInsightView): HTMLElement {
    const element =
      this.insightElements.get(insight.id) ?? document.createElement('beuve-agent-insight');
    element.dataset['insightId'] = insight.id;
    element.insight = insight;
    element.focused = insight.id === this.focusedInsightId;
    this.insightElements.set(insight.id, element);
    return element;
  }

  private renderImpact(): TemplateResult | typeof nothing {
    const banner = describeFileImpact(this.impact, this.findings);
    return banner === undefined
      ? nothing
      : html`<div class="impact ${banner.tone}" title=${banner.title} role="status">
          <span class="label">ImpactGate</span> ${banner.text}
        </div>`;
  }

  private renderCode(file: DiffFileView): TemplateResult {
    if (this.isFallback) {
      return this.renderFallback(file);
    }
    if (file.hunks.length === 0) {
      return html`<p class="empty">${file.binary ? 'Binary file' : 'No textual changes'}</p>`;
    }
    return this.mounted
      ? html`<div class="code"></div>`
      : html`<div
          class="code placeholder"
          style=${styleMap({ height: `${String(this.measuredHeight ?? estimateHeight(file))}px` })}
        ></div>`;
  }

  private renderFallback(file: DiffFileView): TemplateResult {
    const placement = placeInsights(file.patch, this.insights);
    const insight = (shown: AgentInsightView): TemplateResult =>
      html`<beuve-agent-insight
        data-insight-id=${shown.id}
        .insight=${shown}
        ?focused=${shown.id === this.focusedInsightId}
      ></beuve-agent-insight>`;
    return html`${placement.unplaced.map((shown) => insight(shown))}
      <pre>
${splitPatch(file.patch).map(
          (line, index) =>
            html`<span class="line ${line.kind}">${line.text === '' ? ' ' : line.text}</span>${(
                placement.afterLine.get(index) ?? []
              ).map((shown) => insight(shown))}`,
        )}</pre>`;
  }

  /** Scrolls an insight of this card into view, mounting the diff first if needed. */
  async revealInsight(insightId: string): Promise<void> {
    this.mounted = true;
    await this.updateComplete;
    const element =
      this.insightElements.get(insightId) ??
      this.renderRoot.querySelector(
        `beuve-agent-insight[data-insight-id='${CSS.escape(insightId)}']`,
      );
    element?.scrollIntoView({ block: 'center' });
  }

  /** Selects hunk `index` and scrolls its first change into view, mounting the diff if needed. */
  async revealHunk(index: number): Promise<void> {
    this.mounted = true;
    this.activeHunk = index;
    await this.updateComplete;
    const step =
      this.metadata === undefined ? undefined : planHunkSteps(this.metadata.hunks)[index];
    const row =
      step === undefined ? undefined : await waitFor(() => this.findRow(step.side, step.start));
    (row ?? this).scrollIntoView({ block: row === undefined ? 'start' : 'center' });
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('mounted') && this.mounted && this.library === undefined) {
      void this.loadLibrary();
    }
    if (changed.has('mounted') && !this.mounted && this.diff !== undefined) {
      const height = this.renderRoot.querySelector('.code')?.getBoundingClientRect().height;
      this.measuredHeight = height === undefined || height === 0 ? this.measuredHeight : height;
      this.diff.cleanUp();
      this.diff = undefined;
    }
    if (changed.has('file')) {
      this.measuredHeight = undefined;
    }
    if (!changed.has('file') && !changed.has('library')) {
      return;
    }
    const { file, library } = this;
    this.metadata =
      file === undefined || library === undefined ? undefined : toMetadata(library, file);
    this.isFallback = false;
  }

  protected override updated(changed: PropertyValues<this>): void {
    const { library, metadata } = this;
    if (library === undefined || metadata === undefined || !this.mounted || this.isFallback) {
      return;
    }
    const container = this.renderRoot.querySelector<HTMLElement>('.code');
    if (container === null) {
      return;
    }
    try {
      this.syncDiff(library, changed, container, metadata);
    } catch {
      this.diff?.cleanUp();
      this.diff = undefined;
      this.isFallback = true;
    }
  }

  override render(): TemplateResult {
    const { file } = this;
    if (file === undefined) {
      return html``;
    }
    return html`
      <div class="header">
        <div class="title">
          <span class="status">${file.status}</span>
          <span class="path" title=${file.path}>
            ${
              file.oldPath === undefined
                ? nothing
                : html`<span class="old-path">${file.oldPath} → </span>`
            }${file.path}
          </span>
          <span class="additions">+${file.additions}</span>
          <span class="deletions">−${file.deletions}</span>
        </div>
        ${this.renderImpact()}
      </div>
      ${this.peek === undefined ? nothing : html`<beuve-peek-portal .peek=${this.peek}></beuve-peek-portal>`}
      ${this.renderCode(file)}
    `;
  }
}

/** Shared by every card: the library is a lazy chunk, loaded once, themes registered once. */
const shared: { library: Promise<typeof Diffs> | undefined; areThemesRegistered: boolean } = {
  library: undefined,
  areThemesRegistered: false,
};

async function loadDiffs(): Promise<typeof Diffs> {
  shared.library ??= import('@pierre/diffs');
  return shared.library;
}

/** Registers beuve's Alabaster-style themes with the library once (ADR 0025). */
function registerThemes(library: typeof Diffs): void {
  if (shared.areThemesRegistered) {
    return;
  }
  shared.areThemesRegistered = true;
  for (const type of ['light', 'dark'] as const) {
    const name = themeNames[type];
    // eslint-disable-next-line @typescript-eslint/require-await -- the library's loaders are async.
    library.registerCustomTheme(name, async (): Promise<TextmateTheme> =>
      toTextmateTheme(name, type, syntaxPalettes[type]),
    );
  }
}

/** Parses the patch, keyed by its blobs, and turns highlighting off for languages beuve doesn't ship. */
function toMetadata(library: typeof Diffs, file: DiffFileView): FileDiffMetadata | undefined {
  const cacheKey = [file.path, file.oldBlobSha ?? '', file.newBlobSha ?? ''].join('\0');
  const metadata = library.processFile(file.patch, { cacheKey, isGitDiff: true });
  if (metadata === undefined) {
    return undefined;
  }
  const language = library.getFiletypeFromFileName(file.path);
  return Object.hasOwn(highlightedLanguages, language)
    ? metadata
    : library.setLanguageOverride(metadata, 'text');
}

async function loadFiles(
  loader: FilePairLoader,
  fileDiff: FileDiffMetadata,
): Promise<FileDiffLoadedFiles> {
  const pair = await loader(fileDiff.name);
  if (pair?.newContents === undefined) {
    throw new Error('beuve could not load this file to expand it');
  }
  const newFile = { name: fileDiff.name, contents: pair.newContents };
  return pair.oldContents === undefined
    ? // eslint-disable-next-line unicorn/no-null -- the library marks a pure rename's old side with null.
      { oldFile: null, newFile }
    : {
        oldFile: { name: fileDiff.prevName ?? fileDiff.name, contents: pair.oldContents },
        newFile,
      };
}

/** About the rendered height of the patch: its lines, plus a separator per hunk. */
function estimateHeight(file: DiffFileView): number {
  const lines = splitPatch(file.patch).filter(
    (line) => line.kind !== 'meta' && line.kind !== 'hunk',
  ).length;
  return lines * estimatedLineHeight + file.hunks.length * estimatedSeparatorHeight;
}

/** Polls a few animation frames for an element the library renders asynchronously. */
async function waitFor(find: () => Element | undefined): Promise<Element | undefined> {
  for (let frame = 0; frame < 30; frame += 1) {
    const found = find();
    if (found !== undefined) {
      return found;
    }
    await new Promise((resolve) => {
      requestAnimationFrame(resolve);
    });
  }
  return undefined;
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-file-card': BeuveFileCard;
  }
}
