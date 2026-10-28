import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { OpenPullRequestRequest } from '#contract/ipc-contract.ts';

/**
 * Asks for a pull request (URL or `owner/repo#n`) and the local clone to fetch it into. An empty
 * clone path uses the one main remembers for that repository (ADR 0037). Emits
 * `beuve-open-pull-request` with an {@link OpenPullRequestRequest}; `beuve-app` opens it.
 */
@customElement('beuve-open-pull-request-form')
export class BeuveOpenPullRequestForm extends LitElement {
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
      overflow-wrap: anywhere;
    }

    code {
      font: var(--beuve-font-mono);
      font-size: 11px;
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
    const repoPath = field('repoPath');
    const detail: OpenPullRequestRequest = {
      ref: field('ref'),
      ...(repoPath !== '' && { repoPath }),
    };
    this.dispatchEvent(
      new CustomEvent('beuve-open-pull-request', { detail, bubbles: true, composed: true }),
    );
  };

  @property({ type: Boolean }) accessor busy = false;
  @property() accessor error = '';
  /** A command that fixes the error, such as `gh auth login --hostname github.com`. */
  @property() accessor remedy = '';
  /** Prefills the clone path, e.g. with the open pull request session's clone. */
  @property() accessor clonePath = '';

  override render(): TemplateResult {
    return html`
      <form @submit=${this.onSubmit}>
        <label>
          Pull request
          <input
            name="ref"
            required
            placeholder="https://github.com/o/r/pull/1 or o/r#1"
            autocomplete="off"
            spellcheck="false"
          />
        </label>
        <label>
          Local clone
          <input
            name="repoPath"
            .value=${this.clonePath}
            placeholder="/path/to/clone (remembered per repository)"
            autocomplete="off"
            spellcheck="false"
          />
        </label>
        <button type="submit" ?disabled=${this.busy}>
          ${this.busy ? 'Fetching…' : 'Open pull request'}
        </button>
        ${
          this.error === ''
            ? nothing
            : html`<p class="error" role="alert">
                ${this.error}
                ${this.remedy === '' ? nothing : html`Run <code>${this.remedy}</code>.`}
              </p>`
        }
      </form>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-open-pull-request-form': BeuveOpenPullRequestForm;
  }
}
