import { html, LitElement, nothing } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import '../beuve-sheet-code.ts';
import { ActionDelegation } from '../action-delegation.ts';
import type { ActionData } from '../dispatch-action.ts';
import type { Result } from '#x/result/result.ts';
import { createUraNoteIcon } from '../create-ura-note-icon.ts';
import { snippetPathFrom } from '../snippet-path-from.ts';

import { baseLinesFrom } from './base-lines-from.ts';
import type { ChangeRun } from './change-run.ts';
import type { LineRange } from './line-range.ts';
import type { LinkTarget } from './link-target-from.ts';
import { regionStatusFrom } from './region-status-from.ts';
import type { RegionTarget } from './region-target.ts';
import { removedRegionsFrom } from './removed-regions-from.ts';
import type { RichViewKind } from './rich-view-kind-from.ts';
import type { MarkdownSource } from './markdown/markdown-document-from.ts';
import type { MermaidDiagram, MermaidDiagramRequest } from './markdown/render-mermaid-diagram.ts';
import { richViewStyles } from './rich-view-styles.ts';

/** An image of the repository to show, on the side its file is from. */
export interface ImageRequest {
  readonly path: string;
  readonly side: 'head' | 'base';
}

/** Reads a repository image as a `data:` URI at the view's commits; `undefined` when it can't. */
export type ImageLoader = (request: ImageRequest) => Promise<string | undefined>;

/** A slotted child of the view and where it goes: under the top-level region holding `line`. */
export interface RichAnnotation {
  readonly slot: string;
  /** A head line; 0 puts it above the document. */
  readonly line: number;
}

/** `beuve-rich-select` and `beuve-rich-note`: lines the reviewer pointed at. */
export interface RichSelectDetail {
  readonly target: RegionTarget;
}

/** `beuve-rich-link`: a link that leaves the view, for its owner to open. */
export interface RichLinkDetail {
  readonly target: Extract<LinkTarget, { readonly kind: 'external' | 'file' }>;
}

/** The parts of a kind's renderer the view uses. */
interface KindRenderer {
  readonly documentFrom: (source: MarkdownSource) => DocumentFragment;
  readonly drawDiagram: (request: MermaidDiagramRequest) => Promise<Result<MermaidDiagram, string>>;
}

const regionSelector = '[data-source-lines], [data-base-lines]';
const darkScheme = '(prefers-color-scheme: dark)';
const hoveredAnchor = '--beuve-rich-hovered';
const trailingNewline = /\n$/u;

/**
 * A rich view (ADR 0123): a file rendered by its kind, with its regions marked against the
 * review base. Each region (a block, list item or table row) carries its source lines; `runs`
 * mark it added or modified, and with `showsRemoved` the base's wholly removed regions are shown
 * in place and a modified region offers its previous version. A click on a region, or a text
 * selection across regions, emits `beuve-rich-select`; the margin button emits `beuve-rich-note`
 * (with `canNote`). Links to other files and to the web emit `beuve-rich-link`; `#fragment` links
 * scroll the view. Annotations are the owner's slotted children, placed under their regions.
 * Fenced code is highlighted with `beuve-sheet-code`, Mermaid diagrams are drawn as images, and
 * repository images are read through `loadImage`. Nothing in the document can navigate, run
 * script, or load from the network.
 */
@customElement('beuve-rich-view')
export class BeuveRichView extends LitElement {
  static override styles = richViewStyles;

  private generation = 0;
  private built: Promise<void> = Promise.resolve();
  private hovered: HTMLElement | undefined;
  private readonly previousOpen = new Set<string>();
  private readonly previousOf = new Map<string, readonly HTMLElement[]>();
  private readonly scheme = matchMedia(darkScheme);
  private readonly onSchemeChange = (): void => {
    this.requestBuild();
  };

  private readonly onRegionClick = (event: MouseEvent): void => {
    const all = event.composedPath();
    const root = this.documentRoot();
    const path = all.slice(0, Math.max(0, all.indexOf(root ?? this)));
    const isAction = path.some((node) => {
      return node instanceof HTMLElement && node.dataset['action'] !== undefined;
    });
    if (isAction || this.selectedRange() !== undefined) {
      return;
    }
    const region = path.find((node): node is HTMLElement => {
      return node instanceof HTMLElement && node.matches(regionSelector);
    });
    if (region === undefined) {
      return;
    }
    const target = targetOf(region);
    if (target !== undefined) {
      this.emit('beuve-rich-select', { target });
    }
  };

  private readonly onPointerUp = (): void => {
    const target = this.selectedRange();
    if (target !== undefined) {
      this.emit('beuve-rich-select', { target });
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.canNote) {
      return;
    }
    const region = event.composedPath().find((node): node is HTMLElement => {
      return node instanceof HTMLElement && node.matches(regionSelector);
    });
    if (region === undefined || region === this.hovered) {
      return;
    }
    this.hover(region);
  };

  private readonly onPointerLeave = (): void => {
    this.hover(undefined);
  };

  @property() accessor kind: RichViewKind = 'markdown';
  /** The head file's repository path, which its relative links and images start from. */
  @property() accessor path = '';
  /** The base file's path, for a renamed file's removed regions. */
  @property() accessor basePath = '';
  /** The head text; `undefined` for a deleted file. */
  @property({ attribute: false }) accessor head: string | undefined;
  /** The base text; `undefined` for an added file, and in a sheet. */
  @property({ attribute: false }) accessor base: string | undefined;
  @property({ attribute: false }) accessor runs: readonly ChangeRun[] = [];
  /** Show the base's removed regions and a modified region's previous version. */
  @property({ type: Boolean }) accessor showsRemoved = false;
  @property({ type: Boolean }) accessor canNote = false;
  @property({ attribute: false }) accessor annotations: readonly RichAnnotation[] = [];
  @property({ attribute: false }) accessor selected: RegionTarget | undefined;
  @property({ attribute: false }) accessor loadImage: ImageLoader | undefined;

  @state() accessor failure = '';
  @state() accessor isNoteShown = false;

  constructor() {
    super();
    this.addController(
      new ActionDelegation(this, {
        click: {
          link: (data, event): void => {
            event.preventDefault();
            this.followLink(data);
          },
          previous: (data): void => {
            this.togglePrevious(data['previousKey'] ?? '');
          },
          note: (): void => {
            this.noteOnHovered();
          },
        },
        keydown: {
          link: (data, event): void => {
            if (event.key !== 'Enter') {
              return;
            }
            event.preventDefault();
            this.followLink(data);
          },
        },
      }),
    );
  }

  private documentRoot(): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>('.document');
  }

  private requestBuild(): void {
    this.built = this.build();
  }

  private async build(): Promise<void> {
    this.generation += 1;
    const { generation } = this;
    let renderer: KindRenderer;
    try {
      renderer = await loadRenderer();
    } catch {
      this.failure = 'beuve could not load its renderer for this file.';
      return;
    }
    const root = this.documentRoot();
    if (root === null || generation !== this.generation) {
      return;
    }
    this.failure = '';
    const head = document.createDocumentFragment();
    if (this.head !== undefined) {
      head.append(renderer.documentFrom({ text: this.head, file: this.path }));
    }
    for (const region of head.querySelectorAll<HTMLElement>('[data-source-lines]')) {
      const lines = linesOf(region.dataset['sourceLines']);
      if (lines === undefined || this.runs.length === 0) {
        continue;
      }
      const status = regionStatusFrom(lines, this.runs);
      if (status !== 'unchanged') {
        region.dataset['status'] = status;
      }
    }
    this.previousOf.clear();
    if (this.showsRemoved && this.base !== undefined) {
      const base = renderer.documentFrom({ text: this.base, file: this.basePath || this.path });
      this.placeRemoved({ head, base });
    }
    root.replaceChildren(head);
    this.hydrate(root, renderer);
    this.placeAnnotations();
    this.markSelected();
  }

  /**
   * Puts the base's wholly removed top-level regions where their runs are, and remembers the
   * previous version of each modified top-level head region.
   */
  private placeRemoved({ head, base }: Documents): void {
    const baseTop = topRegions(base);
    for (const region of baseTop) {
      asBaseRegion(region);
    }
    const removed = removedRegionsFrom({
      baseRegions: baseTop.map((region) => linesOf(region.dataset['baseLines']) ?? emptyLines),
      runs: this.runs,
    });
    const removedLines = new Set(removed.map(({ lines }) => keyOf(lines)));
    const headTop = topRegions(head);
    for (const { lines, headAt } of removed) {
      const region = baseTop.find((candidate) => {
        return candidate.dataset['baseLines'] === keyOf(lines);
      });
      if (region === undefined) {
        continue;
      }
      region.dataset['status'] = 'removed';
      const before = headTop.find((candidate) => {
        return (linesOf(candidate.dataset['sourceLines'])?.start ?? 0) >= headAt;
      });
      if (before === undefined) {
        head.append(region);
      } else {
        before.before(region);
      }
    }
    for (const region of headTop) {
      const lines = linesOf(region.dataset['sourceLines']);
      if (lines === undefined || region.dataset['status'] !== 'modified') {
        continue;
      }
      const from = baseLinesFrom(lines, this.runs);
      const previous = baseTop.filter((candidate) => {
        const baseLines = linesOf(candidate.dataset['baseLines']);
        return (
          from !== undefined &&
          baseLines !== undefined &&
          !removedLines.has(keyOf(baseLines)) &&
          baseLines.start <= from.end &&
          baseLines.end >= from.start
        );
      });
      if (previous.length === 0) {
        continue;
      }
      const key = keyOf(lines);
      this.previousOf.set(key, previous);
      region.after(this.previousToggle(key));
      if (this.previousOpen.has(key)) {
        this.showPrevious(key);
      }
    }
  }

  private previousToggle(key: string): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'previous-toggle';
    button.dataset['action'] = 'previous';
    button.dataset['previousKey'] = key;
    button.textContent = 'Show previous version';
    return button;
  }

  private togglePrevious(key: string): void {
    if (this.previousOpen.has(key)) {
      this.previousOpen.delete(key);
      this.documentRoot()
        ?.querySelector(`.previous[data-previous-key="${CSS.escape(key)}"]`)
        ?.remove();
      this.labelToggle({ key, label: 'Show previous version' });
      return;
    }
    this.previousOpen.add(key);
    this.showPrevious(key);
  }

  /** Inserts the remembered previous version after its toggle. */
  private showPrevious(key: string): void {
    const previous = this.previousOf.get(key);
    const toggle = this.toggleFor(key);
    if (previous === undefined || toggle === undefined) {
      return;
    }
    const wrapper = document.createElement('div');
    wrapper.className = 'previous';
    wrapper.dataset['previousKey'] = key;
    wrapper.dataset['status'] = 'removed';
    wrapper.append(...previous.map((region) => region.cloneNode(true)));
    toggle.after(wrapper);
    this.labelToggle({ key, label: 'Hide previous version' });
    for (const pre of wrapper.querySelectorAll<HTMLElement>('pre[data-code-language]')) {
      delete pre.dataset['hydrated'];
    }
    void this.hydrateLater(wrapper);
  }

  private async hydrateLater(root: HTMLElement): Promise<void> {
    this.hydrate(root, await loadRenderer());
  }

  private toggleFor(key: string): HTMLElement | undefined {
    const toggle = this.documentRoot()?.querySelector<HTMLElement>(
      `.previous-toggle[data-previous-key="${CSS.escape(key)}"]`,
    );
    return toggle ?? undefined;
  }

  private labelToggle({ key, label }: ToggleLabel): void {
    const toggle = this.toggleFor(key);
    if (toggle !== undefined) {
      toggle.textContent = label;
    }
  }

  /** Highlighted code, diagrams and repository images, filled in after the text is shown. */
  private hydrate(root: HTMLElement, renderer: KindRenderer): void {
    const { generation } = this;
    for (const pre of root.querySelectorAll<HTMLElement>('pre[data-code-language]')) {
      if (pre.dataset['hydrated'] !== undefined) {
        continue;
      }
      pre.dataset['hydrated'] = '';
      const language = pre.dataset['codeLanguage'] ?? '';
      const text = pre.textContent.replace(trailingNewline, '');
      if (pre.dataset['mermaid'] === undefined) {
        const code = document.createElement('beuve-sheet-code');
        code.compact = true;
        code.path = snippetPathFrom(language);
        code.contents = text;
        code.cacheKey = `rich\0${language}\0${text}`;
        pre.classList.add('highlighted');
        pre.replaceChildren(code);
        continue;
      }
      void this.drawDiagram({ pre, text, renderer, generation });
    }
    for (const image of root.querySelectorAll<HTMLImageElement>('img[data-image-path]')) {
      void this.fillImage(image);
    }
  }

  private async drawDiagram({ pre, text, renderer, generation }: DiagramJob): Promise<void> {
    const drawn = await renderer.drawDiagram({ source: text, isDark: this.scheme.matches });
    if (generation !== this.generation) {
      return;
    }
    if (!drawn.ok) {
      const error = document.createElement('div');
      error.className = 'diagram-error';
      error.textContent = `Mermaid could not draw this diagram: ${drawn.error}`;
      pre.after(error);
      return;
    }
    const image = document.createElement('img');
    image.className = 'diagram';
    image.alt = 'Mermaid diagram';
    image.src = drawn.value.uri;
    if (drawn.value.width !== undefined) {
      image.width = drawn.value.width;
    }
    pre.classList.add('diagram-frame');
    pre.replaceChildren(image);
  }

  private async fillImage(image: HTMLImageElement): Promise<void> {
    const path = image.dataset['imagePath'] ?? '';
    let side: 'head' | 'base' = 'head';
    if (image.closest('[data-base-lines]') !== null) {
      side = 'base';
    }
    const uri = await this.loadImage?.({ path, side });
    if (uri === undefined) {
      const missing = document.createElement('span');
      missing.className = 'image-placeholder';
      missing.title = path;
      missing.textContent = `${image.alt || path} (not found)`;
      image.replaceWith(missing);
      return;
    }
    image.src = uri;
  }

  /** Puts each annotation's slot under the top-level region that holds its line. */
  private placeAnnotations(): void {
    const root = this.documentRoot();
    if (root === null) {
      return;
    }
    for (const placed of root.querySelectorAll(':scope > .annotation')) {
      placed.remove();
    }
    const top = topRegions(root).filter((region) => region.dataset['sourceLines'] !== undefined);
    for (const { slot, line } of this.annotations) {
      const wrapper = document.createElement('div');
      wrapper.className = 'annotation';
      const element = document.createElement('slot');
      element.name = slot;
      wrapper.append(element);
      const holder = top.findLast((region) => {
        return (linesOf(region.dataset['sourceLines'])?.start ?? 0) <= line;
      });
      if (line === 0 || holder === undefined) {
        root.prepend(wrapper);
        continue;
      }
      let after: Element = holder;
      while (
        after.nextElementSibling !== null &&
        (after.nextElementSibling.classList.contains('annotation') ||
          after.nextElementSibling.classList.contains('previous-toggle') ||
          after.nextElementSibling.classList.contains('previous'))
      ) {
        after = after.nextElementSibling;
      }
      after.after(wrapper);
    }
  }

  /** Marks the outermost regions inside `selected`, or the region its first line is in. */
  private markSelected(): void {
    const root = this.documentRoot();
    if (root === null) {
      return;
    }
    for (const element of root.querySelectorAll<HTMLElement>('[data-selected]')) {
      delete element.dataset['selected'];
    }
    const { selected } = this;
    if (selected === undefined) {
      return;
    }
    const inside = [...root.querySelectorAll<HTMLElement>(sideSelector(selected.side))].filter(
      (region) => {
        const lines = linesOf(lineValueOf(region, selected.side));
        return (
          lines !== undefined &&
          lines.start >= selected.lines.start &&
          lines.end <= selected.lines.end
        );
      },
    );
    let marked = inside.filter((region) => {
      const parent = region.parentElement?.closest(sideSelector(selected.side));
      return parent === null || parent === undefined || !inside.includes(parent as HTMLElement);
    });
    const fallback = this.regionAt(selected);
    if (fallback !== undefined && marked.length === 0) {
      marked = [fallback];
    }
    for (const region of marked) {
      region.dataset['selected'] = '';
    }
  }

  /** The innermost region of `target`'s side holding its first line, else the next one. */
  private regionAt(target: RegionTarget): HTMLElement | undefined {
    const root = this.documentRoot();
    if (root === null) {
      return undefined;
    }
    const regions = [...root.querySelectorAll<HTMLElement>(sideSelector(target.side))];
    const line = target.lines.start;
    const holding = regions.filter((region) => {
      const lines = linesOf(lineValueOf(region, target.side));
      return lines !== undefined && lines.start <= line && line <= lines.end;
    });
    const innermost = holding.at(-1);
    if (innermost !== undefined) {
      return innermost;
    }
    return regions.find((region) => {
      return (linesOf(lineValueOf(region, target.side))?.start ?? 0) >= line;
    });
  }

  private followLink(data: ActionData): void {
    switch (data['linkKind']) {
      case 'fragment': {
        const anchor = data['linkAnchor'] ?? '';
        const root = this.documentRoot();
        const found =
          root?.querySelector(`[data-anchor="${CSS.escape(anchor)}"]`) ??
          root?.querySelector(`[data-anchor="${CSS.escape(`user-content-${anchor}`)}"]`);
        found?.scrollIntoView({ block: 'start' });
        return;
      }
      case 'external': {
        this.emit('beuve-rich-link', {
          target: { kind: 'external', href: data['linkHref'] ?? '' },
        });
        return;
      }
      case 'file': {
        const line = Number(data['linkLine']);
        const target: RichLinkDetail['target'] = { kind: 'file', path: data['linkPath'] ?? '' };
        if (Number.isSafeInteger(line) && line > 0) {
          this.emit('beuve-rich-link', { target: { ...target, line } });
          return;
        }
        this.emit('beuve-rich-link', { target });
        return;
      }
      default: {
        return;
      }
    }
  }

  private emit(name: string, detail: RichSelectDetail | RichLinkDetail): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  /** Anchors the margin's note button to `region` (CSS anchor positioning), or hides it. */
  private hover(region: HTMLElement | undefined): void {
    this.hovered?.style.removeProperty('anchor-name');
    this.hovered = region;
    region?.style.setProperty('anchor-name', hoveredAnchor);
    this.isNoteShown = region !== undefined;
  }

  private noteOnHovered(): void {
    if (this.hovered === undefined) {
      return;
    }
    const target = targetOf(this.hovered);
    if (target !== undefined) {
      this.emit('beuve-rich-note', { target });
    }
  }

  /** The regions a text selection in the view starts and ends in, as one target. */
  private selectedRange(): RegionTarget | undefined {
    const root = this.shadowRoot;
    const selection = document.getSelection();
    if (root === null || selection === null || selection.isCollapsed) {
      return undefined;
    }
    const [range] = selection.getComposedRanges({ shadowRoots: [root] });
    if (range === undefined || range.collapsed) {
      return undefined;
    }
    const first = regionOfNode(range.startContainer);
    const last = regionOfNode(range.endContainer);
    if (first === undefined || last === undefined) {
      return undefined;
    }
    const start = targetOf(first);
    const end = targetOf(last);
    if (start === undefined || end === undefined) {
      return undefined;
    }
    if (start.side !== end.side) {
      return [start, end].find((target) => target.side === 'head');
    }
    return {
      side: start.side,
      lines: {
        start: Math.min(start.lines.start, end.lines.start),
        end: Math.max(start.lines.end, end.lines.end),
      },
    };
  }

  private renderNoteButton(): TemplateResult | typeof nothing {
    if (!this.isNoteShown || !this.canNote) {
      return nothing;
    }
    return html`<button
      type="button"
      class="note-button"
      data-action="note"
      title="Add a review note on this block"
      aria-label="Add a review note on this block"
    >
      ${createUraNoteIcon()}
    </button>`;
  }

  /**
   * Scrolls to the innermost region that holds the first of `target`'s lines (on a blank line,
   * the next region) and answers that region's lines, once the document is built.
   */
  async reveal(target: RegionTarget): Promise<RegionTarget | undefined> {
    await this.updateComplete;
    await this.built;
    const region = this.regionAt(target);
    if (region === undefined) {
      return undefined;
    }
    region.scrollIntoView({ block: 'center' });
    return targetOf(region);
  }

  /** The region `target`'s first line falls in, as the view would reveal it. */
  async regionFor(target: RegionTarget): Promise<RegionTarget | undefined> {
    await this.updateComplete;
    await this.built;
    const region = this.regionAt(target);
    if (region === undefined) {
      return undefined;
    }
    return targetOf(region);
  }

  override connectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.connectedCallback();
    this.scheme.addEventListener('change', this.onSchemeChange);
  }

  override disconnectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.disconnectedCallback();
    this.scheme.removeEventListener('change', this.onSchemeChange);
  }

  protected override updated(changed: PropertyValues<this>): void {
    const isNewDocument = documentProperties.some((key) => {
      return changed.has(key);
    });
    if (isNewDocument) {
      this.requestBuild();
      return;
    }
    if (changed.has('annotations')) {
      void this.built.then(() => {
        this.placeAnnotations();
      });
    }
    if (changed.has('selected')) {
      void this.built.then(() => {
        this.markSelected();
      });
    }
  }

  override render(): TemplateResult {
    return html`<div class="frame" @pointerleave=${this.onPointerLeave}>
      ${this.failure === '' ? nothing : html`<p class="failure">${this.failure}</p>`}
      <div
        class="document"
        @click=${this.onRegionClick}
        @pointerup=${this.onPointerUp}
        @pointermove=${this.onPointerMove}
      ></div>
      ${this.renderNoteButton()}
    </div>`;
  }
}

/** A Mermaid fence to draw, the renderer, and the build it belongs to. */
interface DiagramJob {
  readonly pre: HTMLElement;
  readonly text: string;
  readonly renderer: KindRenderer;
  readonly generation: number;
}

/** A head document and the base document it is compared with. */
interface Documents {
  readonly head: DocumentFragment;
  readonly base: DocumentFragment;
}

/** A previous-version toggle and its new label. */
interface ToggleLabel {
  readonly key: string;
  readonly label: string;
}

const emptyLines: LineRange = { start: 0, end: -1 };

/** The properties whose change means building the document again. */
const documentProperties = [
  'head',
  'base',
  'runs',
  'path',
  'basePath',
  'showsRemoved',
  'kind',
] as const satisfies readonly (keyof BeuveRichView)[];

async function loadRenderer(): Promise<KindRenderer> {
  const [{ markdownDocumentFrom }, { renderMermaidDiagram }] = await Promise.all([
    import('./markdown/markdown-document-from.ts'),
    import('./markdown/render-mermaid-diagram.ts'),
  ]);
  return { documentFrom: markdownDocumentFrom, drawDiagram: renderMermaidDiagram };
}

/** `a-b` as lines; `undefined` for anything else. */
function linesOf(value = ''): LineRange | undefined {
  const [start, end] = value.split('-', 2).map(Number);
  if (
    start === undefined ||
    end === undefined ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 1 ||
    end < start
  ) {
    return undefined;
  }
  return { start, end };
}

function keyOf(lines: LineRange): string {
  return `${String(lines.start)}-${String(lines.end)}`;
}

/** The regions at the top of a document: its children that carry lines. */
function topRegions(root: ParentNode): HTMLElement[] {
  return [...root.children].filter((child): child is HTMLElement => {
    return child instanceof HTMLElement && child.matches(regionSelector);
  });
}

/** A base region and its descendants carry base lines, so nothing takes them for head lines. */
function asBaseRegion(region: HTMLElement): void {
  for (const element of [region, ...region.querySelectorAll<HTMLElement>('[data-source-lines]')]) {
    const lines = element.dataset['sourceLines'];
    if (lines === undefined) {
      continue;
    }
    element.dataset['baseLines'] = lines;
    delete element.dataset['sourceLines'];
  }
}

function sideSelector(side: 'head' | 'base'): string {
  if (side === 'base') {
    return '[data-base-lines]';
  }
  return '[data-source-lines]';
}

function lineValueOf(region: HTMLElement, side: 'head' | 'base'): string | undefined {
  if (side === 'base') {
    return region.dataset['baseLines'];
  }
  return region.dataset['sourceLines'];
}

function targetOf(region: HTMLElement): RegionTarget | undefined {
  const head = linesOf(region.dataset['sourceLines']);
  if (head !== undefined) {
    return { side: 'head', lines: head };
  }
  const base = linesOf(region.dataset['baseLines']);
  if (base !== undefined) {
    return { side: 'base', lines: base };
  }
  return undefined;
}

function regionOfNode(node: Node): HTMLElement | undefined {
  let element: Element | null = node.parentElement;
  if (node instanceof Element) {
    element = node;
  }
  const region = element?.closest(regionSelector);
  if (region instanceof HTMLElement) {
    return region;
  }
  return undefined;
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-rich-view': BeuveRichView;
  }
}
