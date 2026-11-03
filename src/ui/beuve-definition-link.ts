import { css, html, LitElement } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import type { DefinitionRequest, DefinitionView, IpcResult } from '#contract/ipc-contract.ts';

import { characterOffsetAt } from './character-offset-at.ts';
import type { HoverPoint } from './hover-point.ts';
import { linkOffsetsIn } from './link-offsets-in.ts';
import type { LinkColumns } from './link-offsets-in.ts';

/** Asks main whether the identifier at a position links anywhere (`lsp:definition` with `link`). */
export type DefinitionAsk = (request: DefinitionRequest) => Promise<IpcResult<DefinitionView>>;

/** One line segment of the underline, in viewport coordinates. */
interface LinkBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
}

/** What the last question settled: the identifier it was about and whether it links. */
interface Settled {
  readonly scope: string;
  readonly line: number;
  readonly columns: LinkColumns;
  readonly isLinked: boolean;
}

/** How long the pointer rests on an identifier, ⌘/Ctrl held, before the language server is asked. */
const settleMs = 60;

/**
 * The ⌘/Ctrl-hover underline (ADR 0105): while the modifier is held and the pointer is over a
 * token of a diff or a sheet, asks the language server whether the identifier under it has a
 * definition, and underlines exactly that identifier, with a pointer cursor, only if it does.
 * That is what VS Code and Zed do; a click then follows the definition as it always has. The
 * owner reports tokens with {@link BeuveDefinitionLink.point} and
 * {@link BeuveDefinitionLink.leave}. The underline is an overlay in the top layer that takes no
 * pointer events, so the library's DOM is untouched apart from the token's cursor, and it goes
 * away with the modifier, the pointer, a click, a scroll, a wheel turn or a blur. One question
 * per identifier: the answer, a yes or a no, stands until the pointer is on another one.
 */
@customElement('beuve-definition-link')
export class BeuveDefinitionLink extends LitElement {
  static override styles = css`
    :host {
      display: contents;
    }

    .layer {
      position: fixed;
      inset: 0 auto auto 0;
      width: 0;
      height: 0;
      margin: 0;
      padding: 0;
      border: 0;
      overflow: visible;
      background: none;
      pointer-events: none;
    }

    .box {
      position: fixed;
      height: 1px;
      background: var(--beuve-accent);
    }
  `;

  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  /** Bumped by everything that makes an answer in flight stale. */
  private generation = 0;
  private pending: HoverPoint | undefined;
  private pointer = { clientX: 0, clientY: 0 };
  private isHeld = false;
  private settled: Settled | undefined;
  private cursorElement: HTMLElement | undefined;

  private readonly onPointerMove = (event: PointerEvent): void => {
    this.pointer = { clientX: event.clientX, clientY: event.clientY };
    this.sync(event.metaKey || event.ctrlKey);
    if (this.isHeld && this.pending !== undefined) {
      this.askSoon();
    }
  };

  private readonly onKey = (event: KeyboardEvent): void => {
    this.sync(event.metaKey || event.ctrlKey);
  };

  private readonly onDismiss = (): void => {
    this.hide();
  };

  private readonly onBlur = (): void => {
    this.sync(false);
  };

  @property({ attribute: false }) accessor ask: DefinitionAsk | undefined;
  @property() accessor sessionId = '';
  /** The commit the code on screen is at; the session head when absent. */
  @property() accessor sha: string | undefined;

  @state() accessor boxes: readonly LinkBox[] = [];

  /** The modifier went down or up. */
  private sync(isHeld: boolean): void {
    if (isHeld === this.isHeld) {
      return;
    }
    this.isHeld = isHeld;
    if (!isHeld) {
      this.hide();
    } else if (this.pending !== undefined) {
      this.askSoon();
    }
  }

  private askSoon(): void {
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      void this.consult();
    }, settleMs);
  }

  private async consult(): Promise<void> {
    const { ask, pending } = this;
    if (ask === undefined || pending === undefined || this.sessionId === '' || !this.isHeld) {
      return;
    }
    const character = pending.lineCharStart + characterOffsetAt(pending.tokenElement, this.pointer);
    const scope = `${this.sessionId}\0${this.sha ?? ''}\0${pending.path}`;
    const { settled } = this;
    if (
      settled?.scope === scope &&
      settled.line === pending.line &&
      settled.columns.start <= character &&
      character < settled.columns.end
    ) {
      if (settled.isLinked && this.boxes.length === 0) {
        this.show(pending, settled.columns);
      }
      return;
    }
    this.hide();
    const generation = this.generation;
    const answer = await ask({
      sessionId: this.sessionId,
      ...(this.sha !== undefined && { sha: this.sha }),
      path: pending.path,
      line: pending.line,
      character,
      link: true,
    });
    if (generation !== this.generation || !answer.ok) {
      return;
    }
    const { token: asked, targets } = answer.value;
    if (asked === undefined) {
      this.settled = undefined;
      return;
    }
    const columns = { start: asked.startCharacter, end: asked.endCharacter };
    this.settled = { scope, line: pending.line, columns, isLinked: targets.length > 0 };
    if (targets.length > 0) {
      this.show(pending, columns);
    }
  }

  private show(point: HoverPoint, columns: LinkColumns): void {
    const { tokenElement } = point;
    const offsets = linkOffsetsIn(columns, {
      start: point.lineCharStart,
      length: tokenElement.textContent.length,
    });
    if (offsets === undefined) {
      return;
    }
    const range = rangeIn(tokenElement, offsets);
    if (range === undefined) {
      return;
    }
    this.boxes = Array.from(range.getClientRects(), (rect) => {
      return { left: rect.left, top: rect.bottom - 1, width: rect.width };
    });
    tokenElement.style.cursor = 'pointer';
    this.cursorElement = tokenElement;
  }

  /** The pointer is over (or moved within) a token: what it shows follows once the modifier is held. */
  point(target: HoverPoint): void {
    this.pointer = { clientX: target.clientX, clientY: target.clientY };
    this.pending = target;
    this.hide();
    if (this.isHeld) {
      this.askSoon();
    }
  }

  /** The pointer left its token. */
  leave(): void {
    this.pending = undefined;
    this.hide();
  }

  /** Clears the underline now and drops any question in flight. */
  hide(): void {
    clearTimeout(this.settleTimer);
    this.generation += 1;
    if (this.cursorElement !== undefined) {
      this.cursorElement.style.cursor = '';
      this.cursorElement = undefined;
    }
    if (this.boxes.length > 0) {
      this.boxes = [];
    }
  }

  override connectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.connectedCallback();
    addEventListener('pointermove', this.onPointerMove, { passive: true });
    addEventListener('keydown', this.onKey);
    addEventListener('keyup', this.onKey);
    addEventListener('blur', this.onBlur);
    addEventListener('pointerdown', this.onDismiss, true);
    addEventListener('wheel', this.onDismiss, { capture: true, passive: true });
    addEventListener('scroll', this.onDismiss, { capture: true, passive: true });
  }

  override disconnectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.disconnectedCallback();
    removeEventListener('pointermove', this.onPointerMove);
    removeEventListener('keydown', this.onKey);
    removeEventListener('keyup', this.onKey);
    removeEventListener('blur', this.onBlur);
    removeEventListener('pointerdown', this.onDismiss, true);
    removeEventListener('wheel', this.onDismiss, true);
    removeEventListener('scroll', this.onDismiss, true);
    this.hide();
  }

  protected override updated(changed: PropertyValues<this>): void {
    const layer = this.renderRoot.querySelector<HTMLElement>('.layer');
    if (layer === null || !changed.has('boxes')) {
      return;
    }
    if (this.boxes.length === 0) {
      if (layer.matches(':popover-open')) {
        layer.hidePopover();
      }
      return;
    }
    if (!layer.matches(':popover-open')) {
      layer.showPopover();
    }
  }

  protected override render(): TemplateResult {
    return html`<div class="layer" popover="manual">
      ${this.boxes.map((box) => {
        return html`<div
          class="box"
          style=${styleMap({
            left: `${String(box.left)}px`,
            top: `${String(box.top)}px`,
            width: `${String(box.width)}px`,
          })}
        ></div>`;
      })}
    </div>`;
  }
}

/** The DOM range over `offsets` of the element's text, which may span several text nodes. */
function rangeIn(element: HTMLElement, offsets: LinkColumns): Range | undefined {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const range = element.ownerDocument.createRange();
  let before = 0;
  let isStartSet = false;
  let node = walker.nextNode();
  while (node !== null) {
    const { length } = node.textContent ?? '';
    if (!isStartSet && offsets.start < before + length) {
      range.setStart(node, offsets.start - before);
      isStartSet = true;
    }
    if (isStartSet && offsets.end <= before + length) {
      range.setEnd(node, offsets.end - before);
      return range;
    }
    before += length;
    node = walker.nextNode();
  }
  return undefined;
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-definition-link': BeuveDefinitionLink;
  }
}
