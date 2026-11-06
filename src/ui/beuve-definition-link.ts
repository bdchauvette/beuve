import { LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { DefinitionRequest, DefinitionView, IpcResult } from '#contract/ipc-contract.ts';

import { characterOffsetAt } from './character-offset-at.ts';
import type { HoverPoint } from './hover-point.ts';
import { linkOffsetsIn } from './link-offsets-in.ts';
import type { LinkColumns } from './link-offsets-in.ts';
import { textRangeIn } from './text-range-in.ts';

/** Asks main whether the identifier at a position links anywhere (`lsp:definition` with `link`). */
export type DefinitionAsk = (request: DefinitionRequest) => Promise<IpcResult<DefinitionView>>;

/** What the last question settled: the identifier it was about and whether it links. */
interface Settled {
  readonly scope: string;
  readonly line: number;
  readonly columns: LinkColumns;
  readonly isLinked: boolean;
}

/** The name `index.css` styles with `::highlight()`: the link color and an underline. */
const highlightName = 'beuve-definition-link';
/** How long the pointer rests on an identifier, ⌘/Ctrl held, before the language server is asked. */
const settleMs = 60;

/**
 * The ⌘/Ctrl-hover link (ADR 0105): while the modifier is held and the pointer is over a token of
 * a diff or a sheet, asks the language server whether the identifier under it has a definition,
 * and colors and underlines exactly that identifier, with a pointer cursor, only if it does. That
 * is what VS Code and Zed do; a click then follows the definition as it always has. The owner
 * reports tokens with {@link BeuveDefinitionLink.point} and {@link BeuveDefinitionLink.leave}.
 * The styling is a CSS Custom Highlight over a range of the identifier's text, so the library's
 * DOM is untouched apart from the token's cursor, and it stays on the text through scrolling. It
 * goes away with the modifier, the pointer, a click or a blur. One question per identifier: the
 * answer, a yes or a no, stands until the pointer is on another one.
 */
@customElement('beuve-definition-link')
export class BeuveDefinitionLink extends LitElement {
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  /** Bumped by everything that makes an answer in flight stale. */
  private generation = 0;
  private pending: HoverPoint | undefined;
  private pointer = { clientX: 0, clientY: 0 };
  private isHeld = false;
  private settled: Settled | undefined;
  private cursorElement: HTMLElement | undefined;
  private highlight: Highlight | undefined;

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
      if (settled.isLinked && this.highlight === undefined) {
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
    const range = textRangeIn(tokenElement, offsets);
    if (range === undefined) {
      return;
    }
    this.highlight = new Highlight(range);
    CSS.highlights.set(highlightName, this.highlight);
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

  /** Clears the link now and drops any question in flight. */
  hide(): void {
    clearTimeout(this.settleTimer);
    this.generation += 1;
    if (this.cursorElement !== undefined) {
      this.cursorElement.style.cursor = '';
      this.cursorElement = undefined;
    }
    const { highlight } = this;
    this.highlight = undefined;
    if (highlight !== undefined && CSS.highlights.get(highlightName) === highlight) {
      CSS.highlights.delete(highlightName);
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
  }

  override disconnectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.disconnectedCallback();
    removeEventListener('pointermove', this.onPointerMove);
    removeEventListener('keydown', this.onKey);
    removeEventListener('keyup', this.onKey);
    removeEventListener('blur', this.onBlur);
    removeEventListener('pointerdown', this.onDismiss, true);
    this.hide();
  }

  protected override render(): typeof nothing | TemplateResult {
    return nothing;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-definition-link': BeuveDefinitionLink;
  }
}
