import { css, html, LitElement } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { minimizePatchPreview } from './minimize-patch-preview.ts';
import { splitPatch } from './split-patch.ts';

/**
 * A quiet, read-only preview of a suggested patch (ADR 0043): its hunk lines with the removed and
 * added ones tinted like the diff, file headers and hunk headers left out. Lines the edit kept are
 * shown as context, not as a removal and an identical addition (`minimizePatchPreview`). Used by the Add Note
 * composer and the review dock.
 */
@customElement('beuve-patch-preview')
export class BeuvePatchPreview extends LitElement {
  static override styles = css`
    :host {
      display: block;
      overflow: hidden;
      border: 1px solid var(--beuve-border);
      border-radius: 4px;
      background: var(--beuve-code-bg);
    }

    pre {
      max-height: 160px;
      margin: 0;
      padding: 2px 0;
      overflow: auto;
      font: var(--beuve-font-mono);
      font-size: 11px;
      line-height: 16px;
    }

    span {
      display: block;
      min-width: max-content;
      padding: 0 var(--beuve-space-2);
    }

    .added {
      background: var(--beuve-diff-added-bg);
    }

    .removed {
      background: var(--beuve-diff-removed-bg);
    }

    .context,
    .note {
      color: var(--beuve-text-muted);
    }
  `;

  @property() accessor patch = '';

  override render(): TemplateResult {
    const lines = minimizePatchPreview(
      splitPatch(this.patch).filter((line) => line.kind !== 'meta' && line.kind !== 'hunk'),
    );
    return html`<pre aria-label="Suggested change">
${lines.map((line) => {
        return html`<span class=${line.kind}>${line.text === '' ? ' ' : line.text}</span>`;
      })}</pre>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-patch-preview': BeuvePatchPreview;
  }
}
