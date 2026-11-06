import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { CommitInfoView } from '#contract/ipc-contract.ts';

import { badgeStyles } from '../primitives/badge-styles.ts';
import type { CommitInfoRequestDetail } from '../primitives/beuve-commit.ts';
import { buttonStyles } from '../primitives/button-styles.ts';
import { emptyStateStyles } from '../primitives/empty-state-styles.ts';
import { kbdStyles } from '../primitives/kbd-styles.ts';
import { menuItemStyles } from '../primitives/menu-item-styles.ts';
import { segmentedStyles } from '../primitives/segmented-styles.ts';
import { statusDotStyles } from '../primitives/status-dot-styles.ts';

/**
 * Where a story renders (ADR 0117): a shadow root with every primitive style module, as a
 * component's own would have, so `class="button primary"` looks as it does in the app. It answers
 * `beuve-commit-info` from `commits`, as the review does, so commit cards show without main.
 */
@customElement('beuve-story-frame')
export class BeuveStoryFrame extends LitElement {
  static override styles = [
    buttonStyles,
    kbdStyles,
    statusDotStyles,
    badgeStyles,
    emptyStateStyles,
    segmentedStyles,
    menuItemStyles,
    css`
      :host {
        display: block;
        padding: var(--beuve-space-4);
        background: var(--beuve-surface);
        color: var(--beuve-text);
        font: var(--beuve-font-body);
      }

      .stack {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--beuve-space-3);
      }
    `,
  ];

  private readonly onCommitInfo = (event: CustomEvent<CommitInfoRequestDetail>): void => {
    const info = this.commits.find((commit) => commit.sha === event.detail.sha);
    event.stopPropagation();
    event.detail.respond(Promise.resolve(info));
  };

  /** The story's markup. */
  @property({ attribute: false }) accessor content: TemplateResult | undefined;

  /** Commits the frame reads for commit hashes inside it. */
  @property({ attribute: false }) accessor commits: readonly CommitInfoView[] = [];

  override connectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.connectedCallback();
    this.addEventListener('beuve-commit-info', this.onCommitInfo as EventListener);
  }

  override disconnectedCallback(): void {
    this.removeEventListener('beuve-commit-info', this.onCommitInfo as EventListener);
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.disconnectedCallback();
  }

  protected override render(): TemplateResult {
    return html`<div class="stack">${this.content ?? nothing}</div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-story-frame': BeuveStoryFrame;
  }
}
