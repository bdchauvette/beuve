import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { DiffFileView } from '#contract/ipc-contract.ts';

import { splitPatch } from './split-patch.ts';

/** One file of the review diff: its path, status, line counts and raw patch. */
@customElement('beuve-file-card')
export class BeuveFileCard extends LitElement {
  static override styles = css`
    :host {
      display: block;
      border: 1px solid var(--beuve-border);
      border-radius: var(--beuve-radius);
      background: var(--beuve-surface);
      overflow: hidden;
    }

    :host([active]) {
      border-color: var(--beuve-accent);
      box-shadow: 0 0 0 1px var(--beuve-accent);
    }

    .title {
      display: flex;
      align-items: center;
      gap: var(--beuve-space-2);
      padding: var(--beuve-space-2) var(--beuve-space-3);
      border-bottom: 1px solid var(--beuve-border);
      background: var(--beuve-surface-sunken);
    }

    .path {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      font: var(--beuve-font-mono);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .old-path {
      color: var(--beuve-text-muted);
    }

    .status {
      padding: 0 var(--beuve-space-1);
      border: 1px solid var(--beuve-border);
      border-radius: 4px;
      font: var(--beuve-font-small);
      color: var(--beuve-text-muted);
      text-transform: uppercase;
    }

    .additions {
      font: var(--beuve-font-mono);
      color: var(--beuve-diff-added-text);
    }

    .deletions {
      font: var(--beuve-font-mono);
      color: var(--beuve-diff-removed-text);
    }

    pre {
      margin: 0;
      padding: var(--beuve-space-1) 0;
      overflow-x: auto;
      font: var(--beuve-font-mono);
    }

    .line {
      display: block;
      min-width: max-content;
      padding: 0 var(--beuve-space-3);
    }

    .added {
      background: var(--beuve-diff-added-bg);
      color: var(--beuve-diff-added-text);
    }

    .removed {
      background: var(--beuve-diff-removed-bg);
      color: var(--beuve-diff-removed-text);
    }

    .hunk {
      background: var(--beuve-diff-hunk-bg);
      color: var(--beuve-diff-hunk-text);
    }

    .meta,
    .note {
      color: var(--beuve-text-muted);
    }
  `;

  @property({ attribute: false }) accessor file: DiffFileView | undefined;
  @property({ type: Boolean, reflect: true }) accessor active = false;

  override render(): TemplateResult {
    const { file } = this;
    if (file === undefined) {
      return html``;
    }
    return html`
      <div class="title">
        <span class="status">${file.status}</span>
        <span class="path" title=${file.path}>
          ${
            file.oldPath === undefined
              ? nothing
              : html`<span class="old-path">${file.oldPath} → </span>`
          }${file.path}
        </span>
        <span class="additions">+${file.additions}</span>
        <span class="deletions">−${file.deletions}</span>
      </div>
      <pre>
${splitPatch(file.patch).map(
          (line) =>
            html`<span class="line ${line.kind}">${line.text === '' ? ' ' : line.text}</span>`,
        )}</pre>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-file-card': BeuveFileCard;
  }
}
