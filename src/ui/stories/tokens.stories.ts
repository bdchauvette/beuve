import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { css, html, LitElement } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

const meta: Meta = { title: 'Tokens' };

export default meta;

/** The type roles, largest first. */
const typeRoles = ['title', 'heading', 'body', 'small', 'caption', 'mono'] as const;

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

/** The design tokens of ADR 0114 drawn as they resolve in this theme and diff scheme. */
@customElement('beuve-token-sheet')
class BeuveTokenSheet extends LitElement {
  static override styles = css`
    :host {
      display: grid;
      gap: var(--beuve-space-4);
      padding: var(--beuve-space-4);
      background: var(--beuve-surface);
      color: var(--beuve-text);
      font: var(--beuve-font-body);
    }

    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--beuve-space-3);
    }

    .label {
      inline-size: var(--beuve-size-label);
      color: var(--beuve-text-muted);
      font: var(--beuve-font-small);
    }

    .swatch {
      display: grid;
      gap: var(--beuve-space-1);
      inline-size: var(--beuve-size-field-narrow);
      font: var(--beuve-font-caption);
    }

    .swatch > span:first-child {
      block-size: var(--beuve-size-row);
      border: var(--beuve-border-width) solid var(--beuve-border);
      border-radius: var(--beuve-radius-small);
    }

    .diff {
      margin: 0;
      overflow: hidden;
      border: var(--beuve-border-width) solid var(--beuve-border);
      border-radius: var(--beuve-radius-small);
      background: var(--beuve-code-bg);
      color: var(--beuve-code-text);
      font: var(--beuve-font-mono);
      line-height: var(--beuve-line-height-code);
    }

    .diff > span {
      display: grid;
      grid-template-columns: var(--beuve-size-glyph-column) 1fr;
    }

    .number {
      padding-inline-end: var(--beuve-space-2);
      border-inline-start: var(--beuve-border-width-heavy) solid transparent;
      color: var(--beuve-text-muted);
      text-align: end;
    }

    .removed {
      background: var(--beuve-diff-removed-bg);
    }

    .removed .number {
      border-inline-start-color: var(--beuve-diff-removed-bar);
      background: var(--beuve-diff-removed-number-bg);
    }

    .added {
      background: var(--beuve-diff-added-bg);
    }

    .added .number {
      border-inline-start-color: var(--beuve-diff-added-bar);
      background: var(--beuve-diff-added-number-bg);
    }

    .removed mark {
      background: var(--beuve-diff-removed-emphasis);
      color: inherit;
    }

    .added mark {
      background: var(--beuve-diff-added-emphasis);
      color: inherit;
    }
  `;

  protected override render(): TemplateResult {
    return html`${typeRoles.map((role) => {
        return html`<div class="row">
          <span class="label">--beuve-font-${role}</span>
          <span style=${styleMap({ font: `var(--beuve-font-${role})` })}
            >The quick brown fox reviews the diff</span
          >
        </div>`;
      })}
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
      <pre
        class="diff"
      ><span class="removed"><span class="number">3</span><span>const total = <mark>sum(items)</mark>;</span></span><span class="added"><span class="number">3</span><span>const total = <mark>items.reduce(add, 0)</mark>;</span></span><span><span class="number">4</span><span>return total;</span></span></pre>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-token-sheet': BeuveTokenSheet;
  }
}

export const Tokens: StoryObj = {
  render: () => {
    return html`<beuve-token-sheet></beuve-token-sheet>`;
  },
};
