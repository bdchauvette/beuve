import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import type { CommitInfoView } from '#contract/ipc-contract.ts';

import { buttonStyles } from './button-styles.ts';
import './beuve-time.ts';
import { commitCardFrom } from './commit-card-from.ts';

/**
 * `beuve-commit-info`: a commit hash asks for its commit. Whoever can read it (the review, from
 * `session:get-commit`) calls `respond` once with the answer; `undefined` when it cannot.
 */
export interface CommitInfoRequestDetail {
  readonly sha: string;
  readonly respond: (info: Promise<CommitInfoView | undefined>) => void;
}

/** `beuve-copy-text`: text for the clipboard, which only main writes. */
export interface CopyTextDetail {
  readonly text: string;
}

/** What the card knows so far. */
type Loaded =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly info: CommitInfoView }
  | { readonly status: 'missing' };

/** How long the pointer rests on the hash before the card shows, and how long it may leave. */
const showDelay = Temporal.Duration.from({ milliseconds: 400 });
const hideDelay = Temporal.Duration.from({ milliseconds: 200 });

/**
 * A commit hash (ADR 0116): the first `abbreviation` characters in monospace, and a card with the
 * commit's subject, message, author, committer when different, parents and full hash (with
 * Copy). The card shows when the pointer rests on the hash or the hash takes keyboard focus, and
 * hides when both leave or on Escape. It asks for the commit with a composed `beuve-commit-info`
 * request ({@link CommitInfoRequestDetail}), so the element never calls the bridge; with no answer
 * it shows the full hash alone. A click on the hash is the owner's: put `data-action` on the
 * element.
 */
@customElement('beuve-commit')
export class BeuveCommit extends LitElement {
  static override styles = [
    buttonStyles,
    css`
      :host {
        display: inline;
      }

      .hash {
        padding: 0;
        border: 0;
        background: none;
        color: inherit;
        font: inherit;
        font-family: var(--beuve-font-family-mono);
        text-decoration: underline dotted var(--beuve-text-faint);
        text-underline-offset: var(--beuve-space-0-5);
        cursor: pointer;
      }

      .hash:hover {
        text-decoration-color: currentColor;
      }

      [popover] {
        margin: var(--beuve-space-1) 0 0;
        inline-size: max-content;
        max-inline-size: min(
          var(--beuve-size-popover),
          calc(var(--beuve-size-window-inline) - 2 * var(--beuve-space-2))
        );
        padding: var(--beuve-space-3);
        border: var(--beuve-border-width) solid var(--beuve-border);
        border-radius: var(--beuve-radius);
        background: var(--beuve-surface);
        box-shadow: var(--beuve-shadow-small);
        color: var(--beuve-text);
        font: var(--beuve-font-small);
        text-align: start;
        position-area: block-end span-inline-end;
        position-try-fallbacks: flip-block, flip-inline;
      }

      .subject {
        margin: 0;
        font-weight: var(--beuve-font-weight-semibold);
        overflow-wrap: anywhere;
      }

      .body {
        margin: var(--beuve-space-2) 0 0;
        max-block-size: var(--beuve-size-scroll-short);
        overflow: auto;
        color: var(--beuve-text-muted);
        font: inherit;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }

      .people {
        display: grid;
        gap: var(--beuve-space-0-5);
        margin-block-start: var(--beuve-space-2);
        color: var(--beuve-text-muted);
      }

      .people strong {
        color: var(--beuve-text);
        font-weight: var(--beuve-font-weight-medium);
      }

      .sha {
        display: flex;
        align-items: center;
        gap: var(--beuve-space-2);
        margin-block-start: var(--beuve-space-2);
        padding-block-start: var(--beuve-space-2);
        border-block-start: var(--beuve-border-width) solid var(--beuve-border);
      }

      .sha code {
        font: var(--beuve-font-mono);
        font-size: var(--beuve-font-size-caption);
        overflow-wrap: anywhere;
      }

      .muted,
      .hint {
        color: var(--beuve-text-muted);
      }

      .hint {
        margin: var(--beuve-space-2) 0 0;
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
    const hash = this.renderRoot.querySelector('.hash');
    if (hash !== null && hash.matches(':focus-visible') && event.composedPath().includes(hash)) {
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
    this.renderRoot.querySelector<HTMLElement>('.hash')?.focus();
  };

  /** A click in the card is the card's, never the owner's action on the hash. */
  private readonly onCardClick = (event: Event): void => {
    event.stopPropagation();
  };

  private readonly onCopy = (): void => {
    this.dispatchEvent(
      new CustomEvent<CopyTextDetail>('beuve-copy-text', {
        detail: { text: this.sha },
        bubbles: true,
        composed: true,
      }),
    );
    this.isCopied = true;
  };

  @state() private accessor loaded: Loaded = { status: 'idle' };
  @state() private accessor isCopied = false;

  /** The full commit hash. */
  @property() accessor sha = '';

  /** What a click on the hash does, said at the foot of the card ("Click to open on GitHub"). */
  @property() accessor hint = '';

  /** How many characters of the hash show. */
  @property({ type: Number }) accessor abbreviation = 7;

  private get card(): HTMLElement | undefined {
    return this.renderRoot.querySelector<HTMLElement>('[popover]') ?? undefined;
  }

  private get isShown(): boolean {
    return this.card?.matches(':popover-open') ?? false;
  }

  private show(): void {
    const card = this.card;
    const hash = this.renderRoot.querySelector<HTMLElement>('.hash');
    if (card === undefined || hash === null || this.isShown) {
      return;
    }
    this.isCopied = false;
    this.ask();
    card.showPopover({ source: hash });
  }

  private hide(): void {
    clearTimeout(this.showTimer);
    if (this.isShown) {
      this.card?.hidePopover();
    }
  }

  /** Asks once per hash; a hash nobody answers for shows itself alone. */
  private ask(): void {
    if (this.loaded.status !== 'idle') {
      return;
    }
    const sha = this.sha;
    let answer: Promise<CommitInfoView | undefined> | undefined;
    this.dispatchEvent(
      new CustomEvent<CommitInfoRequestDetail>('beuve-commit-info', {
        detail: {
          sha,
          respond: (info): void => {
            answer = info;
          },
        },
        bubbles: true,
        composed: true,
      }),
    );
    if (answer === undefined) {
      this.loaded = { status: 'missing' };
      return;
    }
    this.loaded = { status: 'loading' };
    void answer.then((info) => {
      if (sha !== this.sha) {
        return;
      }
      if (info === undefined) {
        this.loaded = { status: 'missing' };
        return;
      }
      this.loaded = { status: 'ready', info };
    });
  }

  private renderCard(): TemplateResult {
    const { loaded } = this;
    if (loaded.status === 'ready') {
      const card = commitCardFrom(loaded.info, this.abbreviation);
      return html`<p class="subject">${card.subject}</p>
        ${card.body === '' ? nothing : html`<pre class="body">${card.body}</pre>`}
        <div class="people">
          <span
            ><strong>${card.author.name}</strong> authored
            <beuve-time datetime=${card.author.at} format="relative"></beuve-time
          ></span>
          ${
            card.committer === undefined
              ? nothing
              : html`<span
                  ><strong>${card.committer.name}</strong> committed
                  <beuve-time datetime=${card.committer.at} format="relative"></beuve-time
                ></span>`
          }
          <span>${card.parents}</span>
        </div>
        ${this.renderSha()}`;
    }
    if (loaded.status === 'missing') {
      return html`<span class="muted">Not in this clone</span>${this.renderSha()}`;
    }
    return html`<span class="muted">Reading the commit…</span>${this.renderSha()}`;
  }

  private renderSha(): TemplateResult {
    return html`${this.hint === '' ? nothing : html`<p class="hint">${this.hint}</p>`}
      <div class="sha">
        <code>${this.sha}</code>
        <button class="button quiet" type="button" @click=${this.onCopy}>
          ${this.isCopied ? 'Copied' : 'Copy'}
        </button>
      </div>`;
  }

  override connectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.connectedCallback();
    this.addEventListener('pointerenter', this.onPointerEnter);
    this.addEventListener('pointerleave', this.onPointerLeave);
    this.addEventListener('focusin', this.onFocusIn);
    this.addEventListener('focusout', this.onFocusOut);
    this.addEventListener('keydown', this.onKeyDown);
  }

  override disconnectedCallback(): void {
    clearTimeout(this.showTimer);
    clearTimeout(this.hideTimer);
    this.removeEventListener('pointerenter', this.onPointerEnter);
    this.removeEventListener('pointerleave', this.onPointerLeave);
    this.removeEventListener('focusin', this.onFocusIn);
    this.removeEventListener('focusout', this.onFocusOut);
    this.removeEventListener('keydown', this.onKeyDown);
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.disconnectedCallback();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('sha')) {
      this.loaded = { status: 'idle' };
    }
  }

  protected override render(): TemplateResult {
    return html`<button class="hash" type="button" aria-label="Commit ${this.sha}">
        ${this.sha.slice(0, this.abbreviation)}
      </button>
      <div
        popover="manual"
        role="group"
        @click=${this.onCardClick}
        aria-label="Commit ${this.sha.slice(0, this.abbreviation)}"
      >
        ${this.renderCard()}
      </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-commit': BeuveCommit;
  }
}
