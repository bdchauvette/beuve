import { css, html, LitElement } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { displayIcon } from '../display-icon.ts';
import { badgeStyles } from '../primitives/badge-styles.ts';
import '../primitives/beuve-duration.ts';
import '../primitives/beuve-menu.ts';
import '../primitives/beuve-tab-list.ts';
import '../primitives/beuve-time.ts';
import { buttonStyles } from '../primitives/button-styles.ts';
import { emptyStateStyles } from '../primitives/empty-state-styles.ts';
import { kbdStyles } from '../primitives/kbd-styles.ts';
import { menuItemStyles } from '../primitives/menu-item-styles.ts';
import { segmentedStyles } from '../primitives/segmented-styles.ts';
import { statusDotStyles } from '../primitives/status-dot-styles.ts';

/** Tones that dots and badges take (ADR 0115), muted first. */
const tones = ['muted', 'ok', 'warn', 'danger', 'accent', 'merged'] as const;

/** Semantic color tokens shown as swatches, by group. */
const swatches: readonly (readonly [string, readonly string[]])[] = [
  ['Surfaces', ['bg', 'surface', 'surface-sunken', 'surface-hover', 'surface-pressed', 'code-bg']],
  ['Lines and text', ['border', 'border-strong', 'text', 'text-muted', 'text-faint']],
  [
    'Accent and status',
    ['accent', 'accent-solid', 'accent-soft', 'ok', 'warn', 'danger', 'violet'],
  ],
  [
    'Diff',
    [
      'diff-added-bg',
      'diff-added-number-bg',
      'diff-added-emphasis',
      'diff-added-bar',
      'diff-removed-bg',
      'diff-removed-number-bg',
      'diff-removed-emphasis',
      'diff-removed-bar',
    ],
  ],
];

/** The type roles, largest first. */
const typeRoles = ['title', 'heading', 'body', 'small', 'caption', 'mono'] as const;

/**
 * Every UI primitive (ADR 0115) and the design tokens (ADR 0114) on one page, for review and for
 * `scripts/check-gallery.ts`, which shoots it per theme and diff color scheme. Built only into
 * `dist-test/` (`node scripts/build.ts --gallery`); no shipped bundle contains it.
 */
@customElement('beuve-gallery')
class BeuveGallery extends LitElement {
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
        block-size: 100%;
        overflow: auto;
        box-sizing: border-box;
        padding: var(--beuve-space-6);
        background: var(--beuve-bg);
        color: var(--beuve-text);
        font: var(--beuve-font-body);
      }

      h1 {
        margin: 0 0 var(--beuve-space-4);
        font: var(--beuve-font-title);
      }

      section {
        margin-block-end: var(--beuve-space-6);
        padding: var(--beuve-space-4);
        border: 1px solid var(--beuve-border);
        border-radius: var(--beuve-radius);
        background: var(--beuve-surface);
      }

      h2 {
        margin: 0 0 var(--beuve-space-3);
        color: var(--beuve-text-muted);
        font: var(--beuve-font-small);
        font-weight: var(--beuve-font-weight-semibold);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      .row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--beuve-space-3);
        margin-block-end: var(--beuve-space-3);
      }

      .label {
        inline-size: 8rem;
        color: var(--beuve-text-muted);
        font: var(--beuve-font-small);
      }

      .swatch {
        display: grid;
        gap: var(--beuve-space-1);
        inline-size: 7.5rem;
        font: var(--beuve-font-caption);
      }

      .swatch > span:first-child {
        block-size: 2.5rem;
        border: 1px solid var(--beuve-border);
        border-radius: var(--beuve-radius-small);
      }

      .diff {
        margin: 0;
        overflow: hidden;
        border: 1px solid var(--beuve-border);
        border-radius: var(--beuve-radius-small);
        background: var(--beuve-code-bg);
        color: var(--beuve-code-text);
        font: var(--beuve-font-mono);
        line-height: var(--beuve-line-height-code);
      }

      .diff > span {
        display: grid;
        grid-template-columns: 2.5rem 1fr;
      }

      .diff .number {
        padding-inline-end: var(--beuve-space-2);
        border-inline-start: 3px solid transparent;
        color: var(--beuve-text-muted);
        text-align: end;
      }

      .diff .removed {
        background: var(--beuve-diff-removed-bg);
      }

      .diff .removed .number {
        border-inline-start-color: var(--beuve-diff-removed-bar);
        background: var(--beuve-diff-removed-number-bg);
      }

      .diff .added {
        background: var(--beuve-diff-added-bg);
      }

      .diff .added .number {
        border-inline-start-color: var(--beuve-diff-added-bar);
        background: var(--beuve-diff-added-number-bg);
      }

      .diff .removed mark {
        background: var(--beuve-diff-removed-emphasis);
        color: inherit;
      }

      .diff .added mark {
        background: var(--beuve-diff-added-emphasis);
        color: inherit;
      }

      .tabs [role='tab'] {
        padding: var(--beuve-space-1) var(--beuve-space-2);
        border: 0;
        background: none;
        color: var(--beuve-text-muted);
        font: var(--beuve-font-small);
        box-shadow: inset 0 -2px 0 transparent;
      }

      .tabs [role='tab'][aria-selected='true'] {
        color: var(--beuve-text);
        box-shadow: inset 0 -2px 0 var(--beuve-accent);
      }

      .empty-screen {
        --empty-screen-width: 100%;
        padding: var(--beuve-space-4);
      }
    `,
  ];

  private renderButtons(): TemplateResult {
    return html`<section>
      <h2>Buttons</h2>
      <div class="row">
        <span class="label">Variants</span>
        <button class="button" type="button">Default</button>
        <button class="button primary" type="button">Primary</button>
        <button class="button quiet" type="button">Quiet</button>
        <button class="button link" type="button">Link</button>
        <button class="button icon" type="button" aria-label="Close">×</button>
        <button class="button primary large" type="button">Large primary</button>
      </div>
      <div class="row">
        <span class="label">States</span>
        <button class="button" type="button" disabled>Disabled</button>
        <button class="button primary" type="button" disabled>Disabled primary</button>
        <button class="button" type="button" aria-pressed="true">Pressed</button>
        <button class="button quiet" type="button" aria-expanded="true">Menu open</button>
        <button class="button" type="button">Focus ring</button>
      </div>
    </section>`;
  }

  private renderLabels(): TemplateResult {
    return html`<section>
      <h2>Badges, dots and keys</h2>
      <div class="row">
        <span class="label">Badges</span>
        ${tones.map((tone) => {
          return html`<span class="badge" data-tone=${tone}>${tone}</span>`;
        })}
        <span class="badge dashed">external</span>
        <span class="badge count">3</span>
        <button class="badge" type="button">#123 Stacked</button>
      </div>
      <div class="row">
        <span class="label">Status dots</span>
        ${tones.map((tone) => {
          return html`<span><span class="status-dot" data-tone=${tone}></span> ${tone}</span>`;
        })}
      </div>
      <div class="row">
        <span class="label">Keys</span>
        <kbd>⌘</kbd><kbd>K</kbd> <kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>P</kbd>
      </div>
    </section>`;
  }

  private renderControls(): TemplateResult {
    return html`<section>
      <h2>Segmented, menu and tabs</h2>
      <div class="row">
        <span class="label">Segmented</span>
        <span class="segmented" role="radiogroup" aria-label="Layout">
          <button type="button" role="radio" aria-checked="true">
            ${displayIcon('split')} Split
          </button>
          <button type="button" role="radio" aria-checked="false">
            ${displayIcon('inline')} Inline
          </button>
        </span>
        <span class="segmented" role="group" aria-label="Files shown">
          <button type="button" aria-pressed="false">All</button>
          <button type="button" aria-pressed="true">Changed</button>
        </span>
      </div>
      <div class="row">
        <span class="label">Menu</span>
        <beuve-menu label="Sort">
          <button slot="trigger" class="button quiet" type="button">
            ${displayIcon('sort')}<span>Path</span>${displayIcon('chevron')}
          </button>
          <button type="button" role="menuitemradio" aria-checked="true">
            ${displayIcon('check')}Path
          </button>
          <button type="button" role="menuitemradio" aria-checked="false">
            ${displayIcon('check')}Imports
          </button>
          <h3 class="menu-heading">More</h3>
          <button type="button" role="menuitemcheckbox" aria-checked="true">
            ${displayIcon('check')}Hide drafts
          </button>
          <button type="button" role="menuitem">Clear filters</button>
        </beuve-menu>
      </div>
      <div class="row">
        <span class="label">Tabs</span>
        <beuve-tab-list class="tabs" label="Sidebar">
          <button type="button" role="tab" aria-selected="false">Overview</button>
          <button type="button" role="tab" aria-selected="true">Files</button>
          <button type="button" role="tab" aria-selected="false">Review</button>
        </beuve-tab-list>
      </div>
    </section>`;
  }

  private renderTimes(): TemplateResult {
    const now = Temporal.Now.instant();
    const ago = (duration: Temporal.DurationLike): string => {
      return now.subtract(duration).toString();
    };
    return html`<section>
      <h2>Times and durations</h2>
      <div class="row">
        <span class="label">Absolute</span>
        <beuve-time datetime=${ago({ seconds: 0 })}></beuve-time> ·
        <beuve-time datetime=${ago({ seconds: 0 })} date-style="full"></beuve-time> ·
        <beuve-time datetime=${ago({ seconds: 0 })} time-style="short"></beuve-time>
      </div>
      <div class="row">
        <span class="label">Relative</span>
        <beuve-time datetime=${ago({ seconds: 10 })} format="relative"></beuve-time> ·
        <beuve-time datetime=${ago({ minutes: 5 })} format="relative"></beuve-time> ·
        <beuve-time datetime=${ago({ hours: 3 })} format="relative"></beuve-time> ·
        <beuve-time datetime=${ago({ hours: 30 })} format="relative"></beuve-time> ·
        <beuve-time
          datetime=${ago({ hours: 50 })}
          format="relative"
          format-style="short"
        ></beuve-time>
        ·
        <beuve-time datetime=${ago({ hours: 400 })} format="relative"></beuve-time>
      </div>
      <div class="row">
        <span class="label">Durations</span>
        <beuve-duration value="PT0.712S"></beuve-duration> ·
        <beuve-duration value="PT90S"></beuve-duration> ·
        <beuve-duration value="PT90S" format-style="long"></beuve-duration> ·
        <beuve-duration value="PT2H5M" format-style="digital"></beuve-duration>
      </div>
    </section>`;
  }

  private renderType(): TemplateResult {
    return html`<section>
      <h2>Type</h2>
      ${typeRoles.map((role) => {
        return html`<div class="row">
          <span class="label">--beuve-font-${role}</span>
          <span style=${styleMap({ font: `var(--beuve-font-${role})` })}
            >The quick brown fox reviews the diff</span
          >
        </div>`;
      })}
    </section>`;
  }

  private renderColors(): TemplateResult {
    return html`<section>
      <h2>Colors</h2>
      ${swatches.map(([group, names]) => {
        return html`<div class="row">
          <span class="label">${group}</span>
          ${names.map((name) => {
            return html`<span class="swatch"
              ><span style=${styleMap({ background: `var(--beuve-${name})` })}></span>${name}</span
            >`;
          })}
        </div>`;
      })}
    </section>`;
  }

  private renderDiff(): TemplateResult {
    return html`<section>
      <h2>Diff (this window's scheme)</h2>
      <pre
        class="diff"
      ><span class="removed"><span class="number">3</span><span>const total = <mark>sum(items)</mark>;</span></span><span class="added"><span class="number">3</span><span>const total = <mark>items.reduce(add, 0)</mark>;</span></span><span><span class="number">4</span><span>return total;</span></span></pre>
    </section>`;
  }

  private renderEmpty(): TemplateResult {
    return html`<section>
      <h2>Empty states</h2>
      <p class="empty">No notes staged yet.</p>
      <div class="empty-screen">
        <div>
          <h1>Open a review</h1>
          <p>Pick up where you left off, or paste a pull request link.</p>
        </div>
      </div>
    </section>`;
  }

  protected override render(): TemplateResult {
    return html`<h1>beuve primitives</h1>
      ${this.renderButtons()} ${this.renderLabels()} ${this.renderControls()} ${this.renderTimes()}
      ${this.renderType()} ${this.renderColors()} ${this.renderDiff()} ${this.renderEmpty()}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-gallery': BeuveGallery;
  }
}
