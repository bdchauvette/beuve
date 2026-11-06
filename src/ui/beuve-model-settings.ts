import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import type {
  IpcResult,
  ModelEffortView,
  ModelEntryInput,
  ModelEntryView,
  ModelExecutableView,
  ModelKind,
  ModelRegistryView,
  ModelRole,
  SettingsApi,
} from '#contract/ipc-contract.ts';
import { modelRoles } from '#contract/model-roles.ts';

import { ActionDelegation } from './action-delegation.ts';
import { describeModelEntry } from './describe-model-entry.ts';
import { describeModelTest } from './describe-model-test.ts';
import { isRemoteBaseUrl } from './is-remote-base-url.ts';
import { buttonStyles } from './primitives/button-styles.ts';

/** The form's state: an entry being added or edited, with its fields as typed. */
interface Draft {
  readonly id: string | undefined;
  readonly kind: ModelKind;
  readonly label: string;
  readonly model: string;
  readonly effort: ModelEffortView | '';
  readonly contextWindowTokens: string;
  readonly baseUrl: string;
  readonly tools: boolean;
  readonly executable: 'installed' | 'bundled';
  readonly executablePath: string;
}

/**
 * Settings ▸ Models (ADR 0070): the model registry, which model each role uses, write-only API
 * keys and a Test button. Every change goes to main through the Settings-only `models:*`
 * channels and comes back as the new registry; a key is sent once and never shown again, only
 * "set" or "not set".
 */
@customElement('beuve-model-settings')
export class BeuveModelSettings extends LitElement {
  static override styles = [
    buttonStyles,
    css`
      :host {
        display: block;
      }

      h2 {
        margin: var(--beuve-space-4) 0 var(--beuve-space-2);
        font: var(--beuve-font-small);
        font-weight: var(--beuve-font-weight-semibold);
        color: var(--beuve-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      .group {
        border: 1px solid var(--beuve-border);
        border-radius: var(--beuve-radius);
        background: var(--beuve-surface);
      }

      .row {
        display: grid;
        grid-template-columns: 180px minmax(0, 1fr);
        align-items: center;
        gap: var(--beuve-space-3);
        min-block-size: 32px;
        padding: var(--beuve-space-1) var(--beuve-space-3);
      }

      .row + .row,
      .entry + .entry {
        border-block-start: 1px solid var(--beuve-border);
      }

      .entry {
        display: flex;
        align-items: flex-start;
        gap: var(--beuve-space-2);
        padding: var(--beuve-space-2) var(--beuve-space-3);
      }

      .entry .text {
        flex: 1;
        min-inline-size: 0;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--beuve-space-1);
      }

      .detail {
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
        overflow-wrap: anywhere;
      }

      .ok {
        color: var(--beuve-ok);
      }

      .warn {
        color: var(--beuve-warn);
      }

      input[type='text'],
      input[type='password'],
      input[type='number'],
      select {
        font: inherit;
        color: var(--beuve-text);
        min-inline-size: 0;
      }

      input[type='text'],
      input[type='password'] {
        inline-size: 100%;
        box-sizing: border-box;
      }

      select {
        justify-self: start;
        min-inline-size: 160px;
      }

      .choices {
        display: flex;
        flex-wrap: wrap;
        gap: var(--beuve-space-3);
      }

      .footer {
        display: flex;
        justify-content: flex-end;
        gap: var(--beuve-space-2);
        padding: var(--beuve-space-2) var(--beuve-space-3);
        border-block-start: 1px solid var(--beuve-border);
      }

      .add {
        display: flex;
        gap: var(--beuve-space-2);
        align-items: center;
        padding: var(--beuve-space-2) var(--beuve-space-3);
        border-block-start: 1px solid var(--beuve-border);
      }

      .error {
        margin: var(--beuve-space-2) 0 0;
        color: var(--beuve-danger);
      }
    `,
  ];

  private readonly onWindowFocus = (): void => {
    void this.load();
  };

  @property({ attribute: false }) accessor api: SettingsApi | undefined;

  @state() accessor registry: ModelRegistryView | undefined;
  @state() accessor draft: Draft | undefined;
  @state() accessor newKind: ModelKind = 'openai-compatible';
  @state() accessor apiKey = '';
  @state() accessor remoteModels: readonly string[] = [];
  @state() accessor tests: Readonly<Record<string, string>> = {};
  @state() accessor error = '';

  constructor() {
    super();
    // ADR 0074: the entries' buttons, the executable choices and the role menus, through one
    // listener per type.
    this.addController(
      new ActionDelegation(this, {
        click: {
          test: ({ model = '' }): void => {
            void this.test(model);
          },
          edit: ({ model }): void => {
            const entry = this.entryOf(model);
            if (entry !== undefined) {
              this.startEdit(entry);
            }
          },
          remove: ({ model = '' }): void => {
            void this.removeModel(model);
          },
        },
        change: {
          executable: ({ source }): void => {
            if (source === 'installed' || source === 'bundled') {
              this.edit({ executable: source });
            }
          },
          role: ({ role }, event): void => {
            const known = modelRoles.find((candidate) => candidate === role);
            const id = (event.target as HTMLSelectElement).value;
            if (known !== undefined) {
              void this.setRole(known, id);
            }
          },
        },
      }),
    );
  }

  private entryOf(id: string | undefined): ModelEntryView | undefined {
    return this.registry?.entries.find((entry) => entry.id === id);
  }

  private async removeModel(id: string): Promise<void> {
    this.apply(await this.api?.invoke('models:remove', { id }));
  }

  private async setRole(role: ModelRole, id: string): Promise<void> {
    this.apply(await this.api?.invoke('models:set-role', { role, id }));
  }

  /** Reads the registry afresh, on connection and whenever the window regains focus. */
  private async load(): Promise<void> {
    const listed = await this.api?.invoke('models:list');
    if (listed === undefined) {
      return;
    }
    if (listed.ok) {
      this.registry = listed.value;
    } else {
      this.error = listed.error.message;
    }
  }

  private apply(result: IpcResult<ModelRegistryView> | undefined): boolean {
    if (result === undefined) {
      return false;
    }
    if (!result.ok) {
      this.error = result.error.message;
      return false;
    }
    this.registry = result.value;
    this.error = '';
    return true;
  }

  private startAdd(): void {
    const kind = this.newKind;
    this.apiKey = '';
    this.remoteModels = [];
    this.draft = {
      id: undefined,
      kind,
      label: newLabels[kind],
      model: '',
      effort: '',
      contextWindowTokens: '',
      baseUrl: 'http://localhost:11434/v1',
      tools: false,
      executable: 'installed',
      executablePath: '',
    };
  }

  private startEdit(entry: ModelEntryView): void {
    this.apiKey = '';
    this.remoteModels = [];
    this.draft = draftFrom(entry);
  }

  private edit(change: Partial<Draft>): void {
    if (this.draft !== undefined) {
      this.draft = { ...this.draft, ...change };
    }
  }

  private async save(): Promise<void> {
    const { draft } = this;
    if (draft === undefined) {
      return;
    }
    const saved = await this.api?.invoke('models:save', { entry: entryFrom(draft) });
    if (!this.apply(saved)) {
      return;
    }
    const id = draft.id ?? this.registry?.entries.at(-1)?.id;
    if (id !== undefined && this.apiKey.trim() !== '') {
      this.apply(await this.api?.invoke('models:set-key', { id, apiKey: this.apiKey }));
    }
    this.apiKey = '';
    this.draft = undefined;
  }

  private async setKey(id: string): Promise<void> {
    if (this.apiKey.trim() === '') {
      return;
    }
    const key = this.apiKey;
    this.apiKey = '';
    this.apply(await this.api?.invoke('models:set-key', { id, apiKey: key }));
  }

  private async fetchModels(): Promise<void> {
    const { draft } = this;
    if (draft === undefined) {
      return;
    }
    const listed = await this.api?.invoke('models:list-remote', {
      baseUrl: draft.baseUrl,
      ...(draft.id !== undefined && { id: draft.id }),
    });
    if (listed?.ok === true) {
      this.remoteModels = listed.value.models;
      this.error = '';
      if (listed.value.models.length === 0) {
        this.error = 'The server lists no models.';
      }
    } else if (listed !== undefined) {
      this.error = `${listed.error.message} Type the model id instead.`;
    }
  }

  private async test(id: string): Promise<void> {
    this.tests = { ...this.tests, [id]: 'Testing…' };
    const tested = await this.api?.invoke('models:test', { id });
    let line = '';
    if (tested?.ok === true) {
      line = describeModelTest(tested.value).text;
    } else if (tested !== undefined) {
      line = tested.error.message;
    }
    this.tests = { ...this.tests, [id]: line };
  }

  private renderEntries(registry: ModelRegistryView): TemplateResult {
    return html`<div class="group" data-section="models">
      ${registry.entries.map((entry) => {
        const line = describeModelEntry(entry);
        const tested = this.tests[entry.id];
        return html`<div class="entry" data-model=${entry.id}>
          <div class="text">
            <div>${line.title}</div>
            <div class="detail">${line.detail}</div>
            ${line.warning === undefined ? nothing : html`<div class="detail warn">${line.warning}</div>`}
            ${
              tested === undefined
                ? nothing
                : html`<div class="detail ${tested.startsWith('OK') ? 'ok' : 'warn'}" role="status">
                    ${tested}
                  </div>`
            }
          </div>
          <span class="actions">
            <button class="button" type="button" data-action="test" data-model=${entry.id}>
              Test
            </button>
            <button class="button" type="button" data-action="edit" data-model=${entry.id}>
              Edit
            </button>
            ${
              entry.isDefault
                ? nothing
                : html`<button
                    class="button"
                    type="button"
                    data-action="remove"
                    data-model=${entry.id}
                  >
                    Remove
                  </button>`
            }
          </span>
        </div>`;
      })}
      ${
        this.draft === undefined
          ? html`<div class="add">
              <select
                aria-label="Kind of model to add"
                @change=${(event: Event): void => {
                  this.newKind = (event.target as HTMLSelectElement).value as ModelKind;
                }}
              >
                ${kinds.map(([kind, label]) => {
                  return html`<option value=${kind} ?selected=${kind === this.newKind}>
                    ${label}
                  </option>`;
                })}
              </select>
              <button
                class="button"
                type="button"
                @click=${(): void => {
                  this.startAdd();
                }}
              >
                Add Model…
              </button>
            </div>`
          : nothing
      }
    </div>`;
  }

  private renderForm(draft: Draft, registry: ModelRegistryView): TemplateResult {
    const entry = registry.entries.find((candidate) => candidate.id === draft.id);
    const isRemote = draft.kind === 'openai-compatible' && isRemoteBaseUrl(draft.baseUrl);
    const text = ({ label, value, change, placeholder = '', list }: TextField): TemplateResult => {
      return html`<div class="row">
        <label>${label} </label>
        <input
          type="text"
          aria-label=${label}
          .value=${value}
          placeholder=${placeholder}
          list=${list ?? nothing}
          @input=${(event: Event): void => {
            this.edit(change((event.target as HTMLInputElement).value));
          }}
        />
      </div>`;
    };
    return html`<h2>${draft.id === undefined ? 'Add Model' : 'Edit Model'}</h2>
      <div class="group" data-section="model-form">
        <div class="row">
          <span>Kind</span>
          <span>
            ${kinds.find(([kind]) => kind === draft.kind)?.[1] ?? ''}
            <div class="detail">${kinds.find(([kind]) => kind === draft.kind)?.[2] ?? ''}</div>
          </span>
        </div>
        ${text({
          label: 'Name',
          value: draft.label,
          change: (label) => {
            return { label };
          },
        })}
        ${
          draft.kind === 'openai-compatible'
            ? html`${text({
                  label: 'Base URL',
                  value: draft.baseUrl,
                  change: (baseUrl) => {
                    return { baseUrl };
                  },
                  placeholder: 'http://localhost:11434/v1',
                })}
                ${
                  isRemote
                    ? html`<div class="row">
                        <span></span>
                        <span class="detail warn" role="note"
                          >This server is not on this machine: the diff, your questions and selected
                          lines are sent to it.</span
                        >
                      </div>`
                    : nothing
                }
                ${text({
                  label: 'Model',
                  value: draft.model,
                  change: (model) => {
                    return { model };
                  },
                  placeholder: 'e.g. qwen3:8b',
                  list: 'remote-models',
                })}
                <datalist id="remote-models">
                  ${this.remoteModels.map((model) => {
                    return html`<option value=${model}></option>`;
                  })}
                </datalist>
                <div class="row">
                  <span></span>
                  <span
                    ><button
                      class="button"
                      type="button"
                      @click=${(): void => void this.fetchModels()}
                    >
                      Fetch Models
                    </button></span
                  >
                </div>
                <div class="row">
                  <label>
                    <input
                      type="checkbox"
                      .checked=${draft.tools}
                      @change=${(event: Event): void => {
                        this.edit({ tools: (event.target as HTMLInputElement).checked });
                      }}
                    />
                    Read-only tools
                  </label>
                  <span class="detail"
                    >Lets the model read and search the checkout. Off: it answers from the diff and
                    the selected lines only.</span
                  >
                </div>`
            : text({
                label: 'Model',
                value: draft.model,
                change: (model) => {
                  return { model };
                },
                placeholder:
                  draft.kind === 'claude-agent-sdk' ? 'claude-opus-5-5' : 'Claude Code’s default',
              })
        }
        ${
          draft.kind === 'claude-agent-sdk'
            ? html`<div class="row">
                  <span>Claude Code</span>
                  <span class="choices">
                    ${(['installed', 'bundled'] as const).map((source) => {
                      return html`<label>
                        <input
                          type="radio"
                          name="executable"
                          .checked=${draft.executable === source}
                          ?disabled=${source === 'bundled' && !registry.hasBundledClaudeCode}
                          data-action="executable"
                          data-source=${source}
                        />
                        ${source === 'installed' ? 'Installed' : 'Bundled'}
                      </label>`;
                    })}
                  </span>
                </div>
                ${
                  draft.executable === 'installed'
                    ? text({
                        label: 'Path to claude',
                        value: draft.executablePath,
                        change: (executablePath) => {
                          return { executablePath };
                        },
                        placeholder: 'Found automatically',
                      })
                    : nothing
                }`
            : nothing
        }
        <div class="row">
          <label for="effort">Effort</label>
          <select
            id="effort"
            @change=${(event: Event): void => {
              this.edit({ effort: (event.target as HTMLSelectElement).value as Draft['effort'] });
            }}
          >
            <option value="" ?selected=${draft.effort === ''}>
              ${draft.kind === 'openai-compatible' ? 'Not sent' : 'Default'}
            </option>
            ${efforts.map((effort) => {
              return html`<option value=${effort} ?selected=${draft.effort === effort}>
                ${effort}
              </option>`;
            })}
          </select>
        </div>
        <div class="row">
          <label for="context">Context window</label>
          <input
            id="context"
            type="number"
            min="1024"
            step="1024"
            .value=${draft.contextWindowTokens}
            placeholder=${draft.kind === 'openai-compatible' ? '32768' : 'Unknown'}
            @input=${(event: Event): void => {
              this.edit({ contextWindowTokens: (event.target as HTMLInputElement).value });
            }}
          />
        </div>
        ${draft.kind === 'claude-code-cli' ? nothing : this.renderKey(draft, entry)}
        <div class="footer">
          <button
            class="button"
            type="button"
            @click=${(): void => {
              this.draft = undefined;
              this.apiKey = '';
            }}
          >
            Cancel
          </button>
          <button class="button" type="button" @click=${(): void => void this.save()}>Save</button>
        </div>
      </div>`;
  }

  /** The write-only key field: it shows whether a key is stored, never the key. */
  private renderKey(draft: Draft, entry: ModelEntryView | undefined): TemplateResult {
    const hasKey = entry?.hasApiKey === true;
    const storage = this.registry?.keyStorage;
    return html`<div class="row" data-field="api-key">
        <label for="api-key">API key</label>
        <input
          id="api-key"
          type="password"
          autocomplete="off"
          spellcheck="false"
          .value=${this.apiKey}
          placeholder=${keyPlaceholder(draft, hasKey)}
          ?disabled=${storage === 'unavailable'}
          @input=${(event: Event): void => {
            this.apiKey = (event.target as HTMLInputElement).value;
          }}
        />
      </div>
      <div class="row">
        <span class="detail ${hasKey ? 'ok' : ''}">${hasKey ? 'Key set' : 'Key not set'}</span>
        <span class="actions">
          ${
            entry === undefined
              ? html`<span class="detail">Saved with the model.</span>`
              : html`<button
                    class="button"
                    type="button"
                    @click=${(): void => void this.setKey(entry.id)}
                  >
                    ${hasKey ? 'Replace Key' : 'Save Key'}
                  </button>
                  ${
                    hasKey
                      ? html`<button
                          class="button"
                          type="button"
                          @click=${async (): Promise<void> => {
                            this.apply(
                              await this.api?.invoke('models:remove-key', { id: entry.id }),
                            );
                          }}
                        >
                          Remove Key
                        </button>`
                      : nothing
                  }`
          }
        </span>
      </div>
      ${renderStorageWarning(storage)}`;
  }

  private renderRoles(registry: ModelRegistryView): TemplateResult {
    return html`<h2>Model for</h2>
      <div class="group" data-section="roles">
        ${modelRoles.map((role) => {
          return html`<div class="row">
            <label for=${`role-${role}`}>${roleLabels[role]}</label>
            <select id=${`role-${role}`} data-action="role" data-role=${role}>
              ${registry.entries.map((entry) => {
                return html`<option
                  value=${entry.id}
                  ?selected=${registry.roles[role] === entry.id}
                >
                  ${entry.label}
                </option>`;
              })}
            </select>
          </div>`;
        })}
      </div>`;
  }

  override connectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.connectedCallback();
    addEventListener('focus', this.onWindowFocus);
    void this.load();
  }

  override disconnectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.disconnectedCallback();
    removeEventListener('focus', this.onWindowFocus);
  }

  override render(): TemplateResult {
    const { registry, draft } = this;
    if (registry === undefined) {
      return html`<h2>Models</h2>
        <div class="group">
          <div class="row"><span class="detail">Loading…</span></div>
        </div>`;
    }
    return html`<h2>Models</h2>
      ${this.renderEntries(registry)}
      ${draft === undefined ? nothing : this.renderForm(draft, registry)}
      ${this.renderRoles(registry)}
      ${this.error === '' ? nothing : html`<p class="error" role="alert">${this.error}</p>`}`;
  }
}

const kinds: readonly (readonly [ModelKind, string, string])[] = [
  [
    'openai-compatible',
    'OpenAI-compatible server',
    'Ollama, llama.cpp, vLLM, LM Studio or a gateway that serves /v1/chat/completions.',
  ],
  [
    'claude-agent-sdk',
    'Claude Agent SDK (API key)',
    'Runs Claude Code with an Anthropic API key, billed to that key’s Console account.',
  ],
  [
    'claude-code-cli',
    'Claude Code (your login)',
    'Runs your installed claude CLI with your own Claude Code login.',
  ],
];

const efforts: readonly ModelEffortView[] = ['low', 'medium', 'high', 'xhigh', 'max'];

const roleLabels: Readonly<Record<ModelRole, string>> = {
  chat: 'Questions',
  review: '/review',
  verify: '/review verification',
  summarize: '/summarize',
  compact: '/compact',
};

/** What `models:save` gets from the form: empty fields left out, the number parsed. */
/** A new entry's name until the reviewer types one. */
const newLabels: Readonly<Record<ModelKind, string>> = {
  'openai-compatible': 'Local model',
  'claude-agent-sdk': 'Claude Code (API key)',
  'claude-code-cli': 'Claude Code',
};

/** A text row of the model form. */
interface TextField {
  readonly label: string;
  readonly value: string;
  readonly change: (value: string) => Partial<Draft>;
  readonly placeholder?: string;
  /** The id of a `<datalist>` to suggest from. */
  readonly list?: string;
}

function draftFrom(entry: ModelEntryView): Draft {
  const draft: Draft = {
    id: entry.id,
    kind: entry.kind,
    label: entry.label,
    model: entry.model ?? '',
    effort: entry.effort ?? '',
    contextWindowTokens: entry.contextWindowTokens?.toString() ?? '',
    baseUrl: 'http://localhost:11434/v1',
    tools: false,
    executable: 'installed',
    executablePath: '',
  };
  switch (entry.kind) {
    case 'openai-compatible': {
      return { ...draft, baseUrl: entry.baseUrl, tools: entry.tools };
    }
    case 'claude-agent-sdk': {
      const { executable } = entry;
      if (executable.source === 'installed') {
        return { ...draft, executable: 'installed', executablePath: executable.path ?? '' };
      }
      return { ...draft, executable: 'bundled' };
    }
    case 'claude-code-cli': {
      return draft;
    }
  }
}

function keyPlaceholder(draft: Draft, hasKey: boolean): string {
  if (hasKey) {
    return 'Set — type to replace';
  }
  if (draft.kind === 'openai-compatible') {
    return 'Optional';
  }
  return 'Not set';
}

/** What the key field warns about where keys are stored: nothing for a real keychain. */
function renderStorageWarning(
  storage: ModelRegistryView['keyStorage'] | undefined,
): TemplateResult {
  switch (storage) {
    case 'basic': {
      return html`<div class="row">
        <span></span>
        <span class="detail warn"
          >No keyring was found, so keys are encrypted with a fixed key on this machine.</span
        >
      </div>`;
    }
    case 'unavailable': {
      return html`<div class="row">
        <span></span>
        <span class="detail warn">Keys can’t be stored: no keychain or keyring is available.</span>
      </div>`;
    }
    default: {
      return html``;
    }
  }
}

function executableFrom(
  executable: Draft['executable'],
  executablePath: string,
): ModelExecutableView {
  if (executable === 'bundled') {
    return { source: 'bundled' };
  }
  return { source: 'installed', ...(executablePath !== '' && { path: executablePath }) };
}

function entryFrom(draft: Draft): ModelEntryInput {
  const tokens = Math.trunc(Number(draft.contextWindowTokens.trim() || 'NaN'));
  const common = {
    ...(draft.id !== undefined && { id: draft.id }),
    label: draft.label,
    ...(draft.effort !== '' && { effort: draft.effort }),
    ...(Number.isSafeInteger(tokens) && tokens > 0 && { contextWindowTokens: tokens }),
  };
  const model = draft.model.trim();
  switch (draft.kind) {
    case 'claude-code-cli': {
      return { ...common, kind: 'claude-code-cli', ...(model !== '' && { model }) };
    }
    case 'claude-agent-sdk': {
      const executablePath = draft.executablePath.trim();
      return {
        ...common,
        kind: 'claude-agent-sdk',
        ...(model !== '' && { model }),
        executable: executableFrom(draft.executable, executablePath),
      };
    }
    case 'openai-compatible': {
      return {
        ...common,
        kind: 'openai-compatible',
        model,
        baseUrl: draft.baseUrl.trim(),
        tools: draft.tools,
      };
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-model-settings': BeuveModelSettings;
  }
}
