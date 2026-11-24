import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { ReviewRangeChoiceView, ReviewRangeView } from '#contract/ipc-contract.ts';

import { ActionDelegation } from './action-delegation.ts';
import { displayIcon } from './display-icon.ts';
import { buttonStyles } from './primitives/button-styles.ts';
import { menuItemStyles } from './primitives/menu-item-styles.ts';
import { rangeTriggerLabelFrom } from './range-trigger-label-from.ts';
import { reviewRangeMenuFrom } from './review-range-menu-from.ts';
import type { ReviewRangeOption } from './review-range-menu-from.ts';
import { withPayload } from './with-payload.ts';
import './primitives/beuve-commit.ts';
import './primitives/beuve-menu.ts';
import './primitives/beuve-time.ts';

/**
 * Which changes the review shows (ADR 0142), as a menu in its header: since the last saved
 * progress, the whole change, or since an earlier save, then Remove Last Saved Progress (ADR 0156).
 * Nothing renders until progress was saved. Emits `beuve-review-range` (bubbling, composed) with
 * the {@link ReviewRangeChoiceView} chosen, and `beuve-remove-saved-progress` for the last item.
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
        max-inline-size: 100%;
      }

      .label {
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
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

  /** What the diff shows (`describeReviewScope`), which the trigger names (ADR 0157). */
  @property() accessor scopeText = '';

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
          'remove-last': (): void => {
            this.dispatchEvent(
              new CustomEvent('beuve-remove-saved-progress', { bubbles: true, composed: true }),
            );
          },
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
    if (menu === undefined || this.range === undefined) {
      return nothing;
    }
    const label = rangeTriggerLabelFrom(this.scopeText, this.range.choice);
    return html`<beuve-menu label="Review range">
      <button
        slot="trigger"
        type="button"
        class="button quiet trigger"
        tabindex="-1"
        aria-label="Review range: ${menu.label}"
        title=${`${this.scopeText}. ${menu.title}`}
      >
        <span class="label">${label}</span>${displayIcon('chevron')}
      </button>
      ${menu.options.map((option) => this.renderOption(option))}
      ${
        menu.earlier.length === 0
          ? nothing
          : html`<p class="menu-heading">Earlier saves</p>
              ${menu.earlier.map((option) => this.renderOption(option))}`
      }
      <hr class="menu-separator" />
      <button
        type="button"
        role="menuitem"
        tabindex="-1"
        data-action="remove-last"
        title="Forget the latest save: the review shows what it showed before it"
      >
        Remove Last Saved Progress
      </button>
    </beuve-menu>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-review-range': BeuveReviewRange;
  }
}
