import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { CreateLocalSessionRequest } from '#contract/ipc-contract.ts';

/**
 * Asks for a local repository and the refs to compare. Emits `beuve-open-repository` with a
 * {@link CreateLocalSessionRequest}; `beuve-app` creates the session.
 */
@customElement('beuve-open-repository-form')
export class BeuveOpenRepositoryForm extends LitElement {
  static override styles = css`
    form {
      display: grid;
      gap: var(--beuve-space-2);
    }

    label {
      display: grid;
      gap: 2px;
      font: var(--beuve-font-small);
      color: var(--beuve-text-muted);
    }

    .refs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--beuve-space-2);
    }

    input {
      min-width: 0;
      padding: var(--beuve-space-1) var(--beuve-space-2);
      border: 1px solid var(--beuve-border);
      border-radius: var(--beuve-radius);
      background: var(--beuve-bg);
      color: var(--beuve-text);
      font: var(--beuve-font-mono);
    }

    input:focus {
      border-color: var(--beuve-accent);
      outline: none;
    }

    button {
      padding: var(--beuve-space-1) var(--beuve-space-3);
      border: 1px solid var(--beuve-border);
      border-radius: var(--beuve-radius);
      background: var(--beuve-surface-sunken);
      color: var(--beuve-text);
      font: inherit;
      cursor: pointer;
    }

    button:disabled {
      color: var(--beuve-text-muted);
      cursor: default;
    }

    .error {
      margin: 0;
      font: var(--beuve-font-small);
      color: var(--beuve-danger);
    }
  `;

  private readonly onSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    if (!(event.currentTarget instanceof HTMLFormElement)) {
      return;
    }
    const data = new FormData(event.currentTarget);
    const field = (name: string): string => {
      const value = data.get(name);
      return typeof value === 'string' ? value.trim() : '';
    };
    const detail: CreateLocalSessionRequest = {
      repoPath: field('repoPath'),
      baseRef: field('baseRef'),
      headRef: field('headRef'),
    };
    this.dispatchEvent(
      new CustomEvent('beuve-open-repository', { detail, bubbles: true, composed: true }),
    );
  };

  @property({ type: Boolean }) accessor busy = false;
  @property() accessor error = '';

  override render(): TemplateResult {
    return html`
      <form @submit=${this.onSubmit}>
        <label>
          Repository path
          <input name="repoPath" required placeholder="/path/to/repo" autocomplete="off" />
        </label>
        <div class="refs">
          <label>Base <input name="baseRef" required value="main" autocomplete="off" /></label>
          <label>Head <input name="headRef" required value="HEAD" autocomplete="off" /></label>
        </div>
        <button type="submit" ?disabled=${this.busy}>
          ${this.busy ? 'Opening…' : 'Open local repository'}
        </button>
        ${this.error === '' ? nothing : html`<p class="error" role="alert">${this.error}</p>`}
      </form>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-open-repository-form': BeuveOpenRepositoryForm;
  }
}
