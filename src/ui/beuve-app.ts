import { css, html, LitElement } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/** Root element of the renderer. Placeholder until the four-zone shell lands. */
@customElement('beuve-app')
export class BeuveApp extends LitElement {
  static override styles = css`
    :host {
      display: block;
      padding: var(--beuve-space-4);
      font: var(--beuve-font-body);
    }
  `;

  @property() accessor heading = 'beuve';

  override render(): TemplateResult {
    return html`<h1>${this.heading}</h1>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-app': BeuveApp;
  }
}
