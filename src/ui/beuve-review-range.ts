import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { ReviewRangeChoiceView, ReviewRangeView } from '#contract/ipc-contract.ts';

import { ActionDelegation } from './action-delegation.ts';
import { displayIcon } from './display-icon.ts';
import { buttonStyles } from './primitives/button-styles.ts';
import { menuItemStyles } from './primitives/menu-item-styles.ts';
import { reviewRangeMenuFrom } from './review-range-menu-from.ts';
import type { ReviewRangeOption } from './review-range-menu-from.ts';
import { withPayload } from './with-payload.ts';
import './primitives/beuve-commit.ts';
import './primitives/beuve-menu.ts';
import './primitives/beuve-time.ts';

/**
 * Which changes the review shows (ADR 0140), as a menu in its header: since the last saved
 * progress, the whole change, or since an earlier save. Nothing renders until progress was saved.
 * Emits `beuve-review-range` (bubbling, composed) with the {@link ReviewRangeChoiceView} chosen.
 */
@customElement('beuve-review-range')
export class BeuveReviewRange extends LitElement {
  static override styles = [
    buttonStyles,
    menuItemStyles,
    css`
      :host {
        display: inline-flex;
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
        white-space: nowrap;
      }

      .trigger {
        border-color: var(--beuve-border);
      }

      [role='menuitemradio'] .when {
        margin-inline-start: auto;
        padding-inline-start: var(--beuve-space-3);
        color: var(--beuve-text-muted);
      }
    `,
  ];

  /** The review's range and saved progress, from `ReviewView.range`. */
  @property({ attribute: false }) accessor range: ReviewRangeView | undefined;

  constructor() {
    super();
    this.addController(
      new ActionDelegation(this, {
        click: {
          range: withPayload(
            ({ key }) => {
              return this.choiceOf(key);
            },
            (choice): void => {
              this.dispatchEvent(
                new CustomEvent<ReviewRangeChoiceView>('beuve-review-range', {
                  detail: choice,
                  bubbles: true,
                  composed: true,
                }),
              );
            },
          ),
        },
      }),
    );
  }

  private choiceOf(key: string | undefined): ReviewRangeChoiceView | undefined {
    const menu = reviewRangeMenuFrom(this.range);
    const option = [...(menu?.options ?? []), ...(menu?.earlier ?? [])].find((candidate) => {
      return candidate.key === key;
    });
    if (option === undefined || option.isChecked) {
      return undefined;
    }
    return option.choice;
  }

  private renderOption(option: ReviewRangeOption): TemplateResult {
    const { checkpoint } = option;
    return html`<button
      type="button"
      role="menuitemradio"
      tabindex="-1"
      aria-checked=${option.isChecked ? 'true' : 'false'}
      data-action="range"
      data-key=${option.key}
    >
      ${displayIcon('check')}<span>${option.label}</span>${
        checkpoint === undefined
          ? nothing
          : html`<span class="when"
              ><beuve-commit sha=${checkpoint.headSha}></beuve-commit> ·
              <beuve-time datetime=${checkpoint.savedAt} format="relative"></beuve-time
            ></span>`
      }
    </button>`;
  }

  override render(): TemplateResult | typeof nothing {
    const menu = reviewRangeMenuFrom(this.range);
    if (menu === undefined) {
      return nothing;
    }
    return html`<beuve-menu label="Review range">
      <button
        slot="trigger"
        type="button"
        class="button quiet trigger"
        tabindex="-1"
        aria-label="Review range: ${menu.label}"
        title=${menu.title}
      >
        <span>${menu.label}</span>${displayIcon('chevron')}
      </button>
      ${menu.options.map((option) => this.renderOption(option))}
      ${
        menu.earlier.length === 0
          ? nothing
          : html`<p class="menu-heading">Earlier saves</p>
              ${menu.earlier.map((option) => this.renderOption(option))}`
      }
    </beuve-menu>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-review-range': BeuveReviewRange;
  }
}
