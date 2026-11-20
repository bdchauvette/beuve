import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { UraOriginView } from '#contract/ipc-contract.ts';

import { describeAgentOrigin } from '../describe-agent-origin.ts';
import { buttonStyles } from './button-styles.ts';

/** `beuve-show-in-chat`: the answer a note came from, and the finding or proposal in it. */
export interface ShowInChatDetail {
  readonly messageId: string;
  readonly finding?: number;
  readonly proposal?: number;
}

/** How long the pointer rests on the mark before the card shows, and how long it may leave. */
const showDelay = Temporal.Duration.from({ milliseconds: 300 });
const hideDelay = Temporal.Duration.from({ milliseconds: 200 });

/**
 * ✨, the mark of a note an agent wrote (ADR 0154): a button named "Written by an agent" whose
 * card says where the note came from (a `/review` finding and its confidence, a proposal, an
 * answer) with Show in chat, which asks the owner with a composed `beuve-show-in-chat`
 * ({@link ShowInChatDetail}). The card shows when the pointer rests on the mark or the mark takes
 * keyboard focus, stays while the pointer is over either, and hides when both leave or on
 * Escape; a click pins it. A click never reaches the owner, so the mark can sit in a clickable
 * row. Renders nothing for a note you wrote.
 */
@customElement('beuve-agent-mark')
export class BeuveAgentMark extends LitElement {
  static override styles = [
    buttonStyles,
    css`
      :host {
        display: inline-flex;
      }

      .mark {
        padding: 0;
        border: 0;
        border-radius: var(--beuve-radius-small);
        background: none;
        font: inherit;
        line-height: 1;
        cursor: help;
      }

      .mark:focus-visible {
        outline: var(--beuve-focus-ring);
        outline-offset: var(--beuve-focus-ring-offset);
      }

      [popover] {
        margin: var(--beuve-space-1) 0 0;
        inline-size: max-content;
        max-inline-size: min(
          var(--beuve-size-popover),
          calc(var(--beuve-size-window-inline) - 2 * var(--beuve-space-2))
        );
        padding: var(--beuve-space-2) var(--beuve-space-3);
        border: var(--beuve-border-width) solid var(--beuve-border);
        border-radius: var(--beuve-radius);
        background: var(--beuve-surface);
        box-shadow: var(--beuve-shadow-small);
        color: var(--beuve-text);
        font: var(--beuve-font-small);
        font-weight: var(--beuve-font-weight-normal);
        letter-spacing: normal;
        text-align: start;
        position-area: block-end span-inline-start;
        position-try-fallbacks: flip-block, flip-inline;
      }

      .heading {
        margin: 0;
        font-weight: var(--beuve-font-weight-semibold);
      }

      .source {
        margin: var(--beuve-space-0-5) 0 0;
        color: var(--beuve-text-muted);
      }

      .button.link {
        margin-block-start: var(--beuve-space-1);
      }
    `,
  ];

  private showTimer: ReturnType<typeof setTimeout> | undefined;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;

  private readonly onPointerEnter = (): void => {
    clearTimeout(this.hideTimer);
    if (this.isShown) {
      return;
    }
    this.showTimer = setTimeout(() => {
      this.show();
    }, showDelay.total('millisecond'));
  };

  private readonly onPointerLeave = (): void => {
    clearTimeout(this.showTimer);
    this.hideTimer = setTimeout(() => {
      if (!this.matches(':focus-within')) {
        this.hide();
      }
    }, hideDelay.total('millisecond'));
  };

  private readonly onFocusIn = (event: FocusEvent): void => {
    const mark = this.markElement;
    if (mark?.matches(':focus-visible') === true && event.composedPath().includes(mark)) {
      this.show();
    }
  };

  private readonly onFocusOut = (event: FocusEvent): void => {
    if (event.relatedTarget instanceof Node && this.renderRoot.contains(event.relatedTarget)) {
      return;
    }
    this.hide();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.isShown) {
      return;
    }
    event.stopPropagation();
    this.hide();
    this.markElement?.focus();
  };

  /** A click shows the card (or hides it) and is never the owner's: the row stays as it was. */
  private readonly onClick = (event: Event): void => {
    event.stopPropagation();
  };

  private readonly onMarkClick = (): void => {
    if (this.isShown) {
      this.hide();
    } else {
      this.show();
    }
  };

  private readonly onShowInChat = (): void => {
    const labels = describeAgentOrigin(this.origin);
    if (labels === undefined) {
      return;
    }
    const detail: ShowInChatDetail = {
      messageId: labels.messageId,
      ...(labels.finding !== undefined && { finding: labels.finding }),
      ...(labels.proposal !== undefined && { proposal: labels.proposal }),
    };
    this.hide();
    this.dispatchEvent(
      new CustomEvent<ShowInChatDetail>('beuve-show-in-chat', {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  };

  /** Where the note came from; nothing renders for a note you wrote. */
  @property({ attribute: false }) accessor origin: UraOriginView = { kind: 'human' };

  /** Whether Tab reaches the mark: only on the row that has the list's cursor. */
  @property({ type: Boolean }) accessor focusable = false;

  private get markElement(): HTMLElement | undefined {
    return this.renderRoot.querySelector<HTMLElement>('.mark') ?? undefined;
  }

  private get card(): HTMLElement | undefined {
    return this.renderRoot.querySelector<HTMLElement>('[popover]') ?? undefined;
  }

  private get isShown(): boolean {
    return this.card?.matches(':popover-open') ?? false;
  }

  private show(): void {
    const { card, markElement } = this;
    if (card === undefined || markElement === undefined || this.isShown) {
      return;
    }
    card.showPopover({ source: markElement });
  }

  private hide(): void {
    clearTimeout(this.showTimer);
    if (this.isShown) {
      this.card?.hidePopover();
    }
  }

  override connectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.connectedCallback();
    this.addEventListener('pointerenter', this.onPointerEnter);
    this.addEventListener('pointerleave', this.onPointerLeave);
    this.addEventListener('focusin', this.onFocusIn);
    this.addEventListener('focusout', this.onFocusOut);
    this.addEventListener('keydown', this.onKeyDown);
    this.addEventListener('click', this.onClick);
  }

  override disconnectedCallback(): void {
    clearTimeout(this.showTimer);
    clearTimeout(this.hideTimer);
    this.removeEventListener('pointerenter', this.onPointerEnter);
    this.removeEventListener('pointerleave', this.onPointerLeave);
    this.removeEventListener('focusin', this.onFocusIn);
    this.removeEventListener('focusout', this.onFocusOut);
    this.removeEventListener('keydown', this.onKeyDown);
    this.removeEventListener('click', this.onClick);
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.disconnectedCallback();
  }

  protected override render(): TemplateResult | typeof nothing {
    const labels = describeAgentOrigin(this.origin);
    if (labels === undefined) {
      return nothing;
    }
    return html`<button
        class="mark"
        type="button"
        tabindex=${this.focusable ? '0' : '-1'}
        aria-label="Written by an agent"
        aria-describedby="card"
        @click=${this.onMarkClick}
      >
        <span aria-hidden="true">✨</span>
      </button>
      <div id="card" popover="manual" role="group" aria-label="Written by an agent">
        <p class="heading">Written by an agent</p>
        <p class="source">${labels.source}</p>
        <button class="button link" type="button" @click=${this.onShowInChat}>Show in chat</button>
      </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-agent-mark': BeuveAgentMark;
  }
}
