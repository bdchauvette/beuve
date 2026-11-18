import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { UraSeverityView } from '#contract/ipc-contract.ts';

import './primitives/beuve-menu.ts';
import type { BeuveMenu } from './primitives/beuve-menu.ts';
import { displayIcon } from './display-icon.ts';
import { uraSeverityEmoji } from './ura-severity-emoji.ts';
import { uraSeverityViews } from './ura-severity-views.ts';
import { buttonStyles } from './primitives/button-styles.ts';
import { menuItemStyles } from './primitives/menu-item-styles.ts';

/** `beuve-ura-label-change`: the note's label and Blocking after the reviewer chose. */
export interface UraLabelChange {
  readonly severity: UraSeverityView;
  readonly blocking: boolean;
}

/**
 * A note's label and Blocking decoration as one menu button (ADR 0131 amendment 2026-11-18), the
 * same `beuve-menu` the review queue's Sort, Group and Filter use: the trigger shows the label's
 * emoji and name, `· blocking` when the note blocks, and a chevron; the menu lists the labels as
 * radio items and, after a separator, Blocking as a checkbox item, which leaves the menu open.
 * Choosing a label closes it and focus goes back to the trigger. Escape inside the open menu only
 * closes the menu, so the form around it stays open. The composer and the dock's editor both use
 * it. It updates `severity` and `blocking` itself and emits a composed `beuve-ura-label-change`
 * ({@link UraLabelChange}).
 */
@customElement('beuve-ura-label-menu')
export class BeuveUraLabelMenu extends LitElement {
  static override styles = [
    buttonStyles,
    menuItemStyles,
    css`
      :host {
        display: inline-flex;
        flex: none;
      }

      .blocking {
        color: var(--beuve-danger);
      }
    `,
  ];

  private readonly onMenuClick = (event: Event): void => {
    const item = event.composedPath().find((target): target is HTMLElement => {
      return target instanceof HTMLElement && target.dataset['choice'] !== undefined;
    });
    const choice = item?.dataset['choice'];
    if (choice === undefined) {
      return;
    }
    if (choice === 'blocking') {
      this.change({ severity: this.severity, blocking: !this.blocking });
      return;
    }
    this.change({ severity: choice as UraSeverityView, blocking: this.blocking });
  };

  /** Escape closes only the open menu, never the form the menu sits in. */
  private readonly onMenuKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.menu()?.isOpen === true) {
      event.stopPropagation();
    }
  };

  /** The note's label; a new note is an `issue`. */
  @property() accessor severity: UraSeverityView = 'issue';
  /** Whether the note blocks the merge. */
  @property({ type: Boolean }) accessor blocking = false;

  private menu(): BeuveMenu | undefined {
    return this.renderRoot.querySelector('beuve-menu') ?? undefined;
  }

  private change(next: UraLabelChange): void {
    this.severity = next.severity;
    this.blocking = next.blocking;
    this.dispatchEvent(
      new CustomEvent<UraLabelChange>('beuve-ura-label-change', {
        detail: next,
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Puts the keyboard on the trigger. */
  override focus(options?: FocusOptions): void {
    this.renderRoot.querySelector<HTMLElement>('[slot="trigger"]')?.focus(options);
  }

  override render(): TemplateResult {
    let blockingText = '';
    if (this.blocking) {
      blockingText = ', blocking';
    }
    return html`<beuve-menu label="Label" @click=${this.onMenuClick} @keydown=${this.onMenuKeyDown}>
      <button
        slot="trigger"
        class="button"
        type="button"
        aria-label="Label: ${this.severity}${blockingText}"
        title="The note's label, and whether it blocks the merge"
      >
        <span aria-hidden="true">${uraSeverityEmoji(this.severity)}</span
        ><span>${this.severity}</span
        >${this.blocking ? html`<span class="blocking">· blocking</span>` : nothing}${displayIcon(
          'chevron',
        )}
      </button>
      ${uraSeverityViews.map((severity) => {
        return html`<button
          type="button"
          role="menuitemradio"
          aria-checked=${severity === this.severity ? 'true' : 'false'}
          data-choice=${severity}
        >
          ${displayIcon('check')}<span aria-hidden="true">${uraSeverityEmoji(severity)}</span
          >${severity}
        </button>`;
      })}
      <hr class="menu-separator" />
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked=${this.blocking ? 'true' : 'false'}
        title="A blocking note must be resolved before merging"
        data-choice="blocking"
      >
        ${displayIcon('check')}${displayIcon('blocking')}Blocking
      </button>
    </beuve-menu>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-ura-label-menu': BeuveUraLabelMenu;
  }
}
