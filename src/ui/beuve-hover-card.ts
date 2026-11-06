import { css, html, LitElement } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import type {
  DiagnosticItemView,
  HoverRequest,
  HoverView,
  IpcResult,
} from '#contract/ipc-contract.ts';

import { characterOffsetAt } from './character-offset-at.ts';
import { createDiagnosticNode } from './create-diagnostic-node.ts';
import { createMarkdownNodes } from './create-markdown-nodes.ts';
import { createPlainMarkdownRenderers } from './create-plain-markdown-renderers.ts';
import type { DiagnosticPosition } from './diagnostics-at.ts';
import type { HoverPoint } from './hover-point.ts';
import { parseMarkdown } from './parse-markdown.ts';
import { placeHoverCard } from './place-hover-card.ts';
import type { HoverAnchor } from './place-hover-card.ts';

/** Asks main what the language server says at a position (`lsp:hover`). */
export type HoverAsk = (request: HoverRequest) => Promise<IpcResult<HoverView>>;

/** The diagnostics the window already has for a place in a file (ADR 0111). */
export type DiagnosticsFor = (path: string, position: DiagnosticPosition) => DiagnosticItemView[];

/**
 * What the card shows, and where it was asked about, so the same spot isn't asked twice. The
 * diagnostics there show at once; `isAnswered` says the language server's text has come (or
 * there is none), so only a spot that is still waiting for it is asked again.
 */
interface ShownHover {
  readonly key: string;
  readonly markdown: string;
  readonly diagnostics: readonly DiagnosticItemView[];
  readonly isAnswered: boolean;
  readonly anchor: HoverAnchor;
}

/** How long the pointer rests on a token before the language server is asked. */
const dwellMs = 300;
/** The rest required while a card is already open, so moving between tokens feels immediate. */
const warmDwellMs = 40;
/** How long the card outlives the pointer leaving a token, so crossing to its neighbour or the card doesn't flicker. */
const graceMs = 150;

/**
 * The language server's hover for the token the pointer rests on (diff cards and sheets). The
 * owner reports tokens with {@link BeuveHoverCard.point} and {@link BeuveHoverCard.leave}; after
 * the pointer rests for a moment the card asks, and shows the Markdown in a top-layer popover
 * below (or above) the token. The server's text is rendered as untrusted Markdown by the same
 * node builder as chat answers: no raw HTML, code as plain blocks, links inert. Answers for a
 * pointer that has moved on are dropped, and a failure or an empty answer shows nothing. The card
 * takes no focus and no key, and goes away on a click, a scroll, a wheel turn or a blur.
 */
@customElement('beuve-hover-card')
export class BeuveHoverCard extends LitElement {
  static override styles = css`
    :host {
      display: contents;
    }

    .card {
      position: fixed;
      inset: auto;
      box-sizing: border-box;
      inline-size: max-content;
      max-inline-size: min(
        var(--beuve-size-popover),
        calc(var(--beuve-size-window-inline) - 2 * var(--beuve-space-2))
      );
      max-block-size: min(var(--beuve-size-hint-block), var(--beuve-size-window-block-50));
      margin: 0;
      padding: var(--beuve-space-2) var(--beuve-space-3);
      overflow: auto;
      border: var(--beuve-border-width) solid var(--beuve-border);
      border-radius: var(--beuve-radius);
      background: var(--beuve-surface);
      box-shadow: var(--beuve-shadow-small);
      color: var(--beuve-text);
      font: var(--beuve-font-small);
      overflow-wrap: anywhere;
    }

    .card :is(p, ul, ol, blockquote, hr, h1, h2, h3, h4, h5, h6, pre) {
      margin: 0 0 var(--beuve-space-2);
    }

    .card > :last-child {
      margin-block-end: 0;
    }

    .card :is(h1, h2, h3, h4, h5, h6) {
      font: inherit;
      font-weight: var(--beuve-font-weight-semibold);
    }

    .card :is(ul, ol) {
      padding-inline-start: var(--beuve-space-4);
    }

    .card hr {
      border: 0;
      border-block-start: var(--beuve-border-width) solid var(--beuve-border);
    }

    .card pre {
      padding: var(--beuve-space-1) var(--beuve-space-2);
      overflow-x: auto;
      border-radius: var(--beuve-radius);
      background: var(--beuve-surface-sunken);
      font: var(--beuve-font-mono);
      font-size: var(--beuve-font-size-caption);
      white-space: pre-wrap;
    }

    .card code {
      font: var(--beuve-font-mono);
      font-size: var(--beuve-font-size-caption);
    }

    .card a {
      color: inherit;
      text-decoration: underline dotted;
      cursor: default;
    }

    .card .diagnostic {
      margin: 0 0 var(--beuve-space-2);
      padding-inline-start: var(--beuve-space-2);
      border-inline-start: var(--beuve-border-width-thick) solid var(--beuve-text-muted);
      white-space: pre-wrap;
    }

    .card .diagnostic.error {
      border-inline-start-color: var(--beuve-danger);
    }

    .card .diagnostic.warning {
      border-inline-start-color: var(--beuve-warn);
    }

    .card .diagnostic.information {
      border-inline-start-color: var(--beuve-accent);
    }

    .card .diagnostic-origin {
      color: var(--beuve-text-muted);
    }
  `;

  private dwellTimer: ReturnType<typeof setTimeout> | undefined;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;
  /** Bumped by everything that makes an answer in flight stale. */
  private generation = 0;
  private pending: HoverPoint | undefined;
  private pointer = { clientX: 0, clientY: 0 };
  private renderedKey = '';

  private readonly onPointerMove = (event: PointerEvent): void => {
    this.pointer = { clientX: event.clientX, clientY: event.clientY };
    if (this.pending !== undefined) {
      this.point({ ...this.pending, clientX: event.clientX, clientY: event.clientY });
    }
  };

  /** A click, wheel turn, scroll or blur elsewhere; the card's own text can be selected and scrolled. */
  private readonly onDismiss = (event: Event): void => {
    const card = this.renderRoot.querySelector('.card');
    if (card !== null && event.composedPath().includes(card)) {
      return;
    }
    this.dismiss();
  };

  private readonly keepOpen = (): void => {
    clearTimeout(this.hideTimer);
  };

  @property({ attribute: false }) accessor ask: HoverAsk | undefined;
  /** The diagnostics for a place in a file, which show above what the server says there. */
  @property({ attribute: false }) accessor diagnosticsFor: DiagnosticsFor | undefined;
  @property() accessor sessionId = '';
  /** The commit the code on screen is at; the session head when absent. */
  @property() accessor sha: string | undefined;

  @state() accessor shown: ShownHover | undefined;

  private async consult(): Promise<void> {
    const { ask, pending } = this;
    if (ask === undefined || pending === undefined || this.sessionId === '') {
      return;
    }
    const character = pending.lineCharStart + characterOffsetAt(pending.tokenElement, this.pointer);
    const key = `${this.sessionId}\0${this.sha ?? ''}\0${pending.path}\0${String(pending.line)}\0${String(character)}`;
    if (this.shown?.key === key && this.shown.isAnswered) {
      return;
    }
    const bounds = pending.tokenElement.getBoundingClientRect();
    const anchor: HoverAnchor = { x: this.pointer.clientX, top: bounds.top, bottom: bounds.bottom };
    const diagnostics =
      this.diagnosticsFor?.(pending.path, { line: pending.line, character }) ?? [];
    if (diagnostics.length > 0 && this.shown?.key !== key) {
      this.shown = { key, markdown: '', diagnostics, isAnswered: false, anchor };
    }
    const generation = this.generation;
    const answer = await ask({
      sessionId: this.sessionId,
      ...(this.sha !== undefined && { sha: this.sha }),
      path: pending.path,
      line: pending.line,
      character,
    });
    if (generation !== this.generation) {
      return;
    }
    let markdown = '';
    if (answer.ok && answer.value.hover !== undefined) {
      markdown = answer.value.hover.markdown;
    }
    if (markdown === '' && diagnostics.length === 0) {
      this.shown = undefined;
      return;
    }
    this.shown = { key, markdown, diagnostics, isAnswered: true, anchor };
  }

  /**
   * The pointer is over (or moved within) a token: ask once it rests. The first card waits
   * {@link dwellMs}; while a card is open (it outlives the pointer by {@link graceMs}) the next
   * token waits only {@link warmDwellMs}.
   */
  point(target: HoverPoint): void {
    this.pointer = { clientX: target.clientX, clientY: target.clientY };
    clearTimeout(this.hideTimer);
    clearTimeout(this.dwellTimer);
    this.pending = target;
    this.generation += 1;
    let delay = dwellMs;
    if (this.shown !== undefined) {
      delay = warmDwellMs;
    }
    this.dwellTimer = setTimeout(() => {
      void this.consult();
    }, delay);
  }

  /** The pointer left its token: forget the pending question and hide the card shortly. */
  leave(): void {
    clearTimeout(this.dwellTimer);
    this.pending = undefined;
    this.generation += 1;
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      this.dismiss();
    }, graceMs);
  }

  /** Hides the card now and drops any question in flight. */
  dismiss(): void {
    clearTimeout(this.dwellTimer);
    clearTimeout(this.hideTimer);
    this.pending = undefined;
    this.generation += 1;
    this.shown = undefined;
  }

  override connectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.connectedCallback();
    addEventListener('pointermove', this.onPointerMove, { passive: true });
    addEventListener('pointerdown', this.onDismiss, true);
    addEventListener('wheel', this.onDismiss, { capture: true, passive: true });
    addEventListener('scroll', this.onDismiss, { capture: true, passive: true });
    addEventListener('blur', this.onDismiss);
  }

  override disconnectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.disconnectedCallback();
    removeEventListener('pointermove', this.onPointerMove);
    removeEventListener('pointerdown', this.onDismiss, true);
    removeEventListener('wheel', this.onDismiss, true);
    removeEventListener('scroll', this.onDismiss, true);
    removeEventListener('blur', this.onDismiss);
    this.dismiss();
  }

  protected override updated(changed: PropertyValues<this>): void {
    const card = this.renderRoot.querySelector<HTMLElement>('.card');
    const { shown } = this;
    if (card === null) {
      return;
    }
    if (shown === undefined) {
      if (card.matches(':popover-open')) {
        card.hidePopover();
      }
      this.renderedKey = '';
      return;
    }
    if (!changed.has('shown') && card.matches(':popover-open')) {
      return;
    }
    const rendered = `${shown.key}\0${String(shown.isAnswered)}`;
    if (rendered !== this.renderedKey) {
      card.replaceChildren(
        ...shown.diagnostics.map((diagnostic) => createDiagnosticNode(diagnostic)),
        ...createMarkdownNodes(parseMarkdown(shown.markdown), createPlainMarkdownRenderers()),
      );
      this.renderedKey = rendered;
    }
    if (!card.matches(':popover-open')) {
      card.showPopover();
    }
    card.scrollTop = 0;
    const { width, height } = card.getBoundingClientRect();
    const { left, top } = placeHoverCard(
      shown.anchor,
      { width, height },
      { width: innerWidth, height: innerHeight },
    );
    card.style.left = `${String(left)}px`;
    card.style.top = `${String(top)}px`;
  }

  protected override render(): TemplateResult {
    return html`<div
      class="card"
      popover="manual"
      @pointerenter=${this.keepOpen}
      @pointerleave=${(): void => {
        this.leave();
      }}
      @click=${(event: Event): void => {
        if ((event.target as Element | null)?.closest('a') !== null) {
          event.preventDefault();
        }
      }}
    ></div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-hover-card': BeuveHoverCard;
  }
}
