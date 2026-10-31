import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import type { TraceResultView } from '#contract/ipc-contract.ts';

import { ActionDelegation } from './action-delegation.ts';
import { describeTraceSummary } from './describe-trace-summary.ts';
import { findAnchorRow } from './find-anchor-row.ts';
import { keyPlatformOf } from './key-platform-of.ts';
import { planTraceTimeline } from './plan-trace-timeline.ts';
import type { TraceCase, TraceRow } from './plan-trace-timeline.ts';
import { shortcutOf } from './shortcut-of.ts';
import type { TraceState } from './trace-state.ts';
import { formatControlStyles } from './format-control-styles.ts';
import { pathText } from './path-text.ts';

/** Detail of `trace-line-activate`: the head line of the step the reviewer chose. */
export interface TraceLineActivateDetail {
  readonly line: number;
}

/**
 * The trace timeline portal (spec 5E, Run Trace Probe): the tests that covered the hunk, each with its steps
 * in order, indented by call depth; steps inside the hunk carry the accent and every line number
 * jumps to that line in the card. Before the first run in a repository it asks for approval to
 * run the repository's tests (ADR 0041). Presentational: it fires `trace-line-activate`,
 * `beuve-trace-trust` and `beuve-trace-close`; the owner decides what they do.
 */
@customElement('beuve-trace-portal')
export class BeuveTracePortal extends LitElement {
  static override styles = [
    formatControlStyles,
    css`
      :host {
        display: block;
        border-bottom: 1px solid var(--beuve-border);
        background: var(--beuve-bg);
        font: var(--beuve-font-small);
      }

      .close,
      .again {
        padding: 0 var(--beuve-space-1);
        border: none;
        background: none;
        color: var(--beuve-text-muted);
        font: inherit;
        cursor: pointer;
      }

      .close {
        font-size: 15px;
        line-height: 1;
      }

      .heading {
        display: flex;
        align-items: baseline;
        gap: var(--beuve-space-2);
        padding: var(--beuve-space-2) var(--beuve-space-3) var(--beuve-space-1);
        color: var(--beuve-text-muted);
      }

      .heading .spacer {
        flex: 1;
      }

      .summary {
        margin: 0;
        padding: 0 var(--beuve-space-3) var(--beuve-space-2);
        color: var(--beuve-text-muted);
      }

      .note {
        margin: 0;
        padding: 2px var(--beuve-space-3) var(--beuve-space-2);
        color: var(--beuve-text-muted);
      }

      .note.error,
      .note.fail {
        color: var(--beuve-danger);
      }

      .files {
        margin: 0;
        padding: 0 var(--beuve-space-3) var(--beuve-space-2);
        list-style: none;
        font: var(--beuve-font-mono);
        color: var(--beuve-text-muted);
      }

      .scroll {
        max-height: 50vh;
        overflow: auto;
        padding-bottom: var(--beuve-space-2);
      }

      section.case {
        padding-top: var(--beuve-space-2);
      }

      .case-head {
        display: flex;
        align-items: baseline;
        gap: var(--beuve-space-2);
        padding: 0 var(--beuve-space-3) var(--beuve-space-1);
      }

      .case-title {
        font-weight: 600;
        color: var(--beuve-text);
      }

      .status {
        display: inline-flex;
        align-items: center;
        gap: var(--beuve-space-1);
        color: var(--beuve-text-muted);
      }

      .status::before {
        content: '';
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--beuve-text-muted);
      }

      .status.passed::before {
        background: var(--beuve-ok);
      }

      .status.failed {
        color: var(--beuve-danger);
      }

      .status.failed::before {
        background: var(--beuve-danger);
      }

      .duration {
        color: var(--beuve-text-muted);
      }

      .failure {
        margin: 0;
        padding: 0 var(--beuve-space-3) var(--beuve-space-1);
        color: var(--beuve-danger);
        font: var(--beuve-font-mono);
        font-size: 11px;
      }

      .quiet {
        margin: 0;
        padding: 0 var(--beuve-space-3);
        color: var(--beuve-text-muted);
      }

      ol {
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .row {
        display: flex;
        align-items: baseline;
        gap: var(--beuve-space-2);
        width: 100%;
        box-sizing: border-box;
        padding: 1px var(--beuve-space-3);
        border: 0;
        border-left: 2px solid transparent;
        background: transparent;
        color: var(--beuve-text);
        font: var(--beuve-font-mono);
        text-align: left;
        cursor: pointer;
      }

      .row:hover {
        background: var(--beuve-surface-sunken);
      }

      .row:focus-visible {
        outline: 1px solid var(--beuve-accent);
        outline-offset: -1px;
      }

      .row.in-hunk {
        border-left-color: var(--beuve-accent);
        background: var(--beuve-accent-soft);
      }

      .line {
        flex: none;
        min-width: 4ch;
        text-align: right;
        color: var(--beuve-text-muted);
      }

      .in-hunk .line {
        color: var(--beuve-accent);
        font-weight: 600;
      }

      .row:hover .line {
        text-decoration: underline;
      }

      .indent {
        flex: none;
        width: calc(var(--depth) * 14px);
      }

      .tag {
        flex: none;
        min-width: 5ch;
        color: var(--beuve-text-muted);
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      .in-hunk .tag {
        color: var(--beuve-accent);
      }

      .text {
        flex: 0 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .result {
        flex: none;
        color: var(--beuve-text-muted);
        white-space: nowrap;
      }

      .result.taken {
        color: var(--beuve-ok);
      }

      .result.danger,
      .row.danger .text {
        color: var(--beuve-danger);
      }

      .prompt {
        margin: 0 var(--beuve-space-3) var(--beuve-space-3);
        padding: var(--beuve-space-3);
        border: 1px solid var(--beuve-border);
        border-radius: var(--beuve-radius);
        background: var(--beuve-surface);
        font: var(--beuve-font-body);
      }

      .prompt h4 {
        margin: 0 0 var(--beuve-space-1);
        font-size: 13px;
      }

      .prompt p {
        margin: 0 0 var(--beuve-space-2);
        color: var(--beuve-text-muted);
      }

      .prompt code {
        font: var(--beuve-font-mono);
        color: var(--beuve-text);
      }

      .actions {
        display: flex;
        gap: var(--beuve-space-2);
        margin-top: var(--beuve-space-3);
      }

      button.action {
        padding: var(--beuve-space-1) var(--beuve-space-3);
        border: 1px solid var(--beuve-border);
        border-radius: var(--beuve-radius);
        background: var(--beuve-surface);
        color: var(--beuve-text);
        font: inherit;
        cursor: pointer;
      }

      button.action.primary {
        border-color: var(--beuve-accent);
        background: var(--beuve-accent);
        color: #fff;
      }

      button.action:focus-visible {
        outline: 2px solid var(--beuve-accent);
        outline-offset: 2px;
      }

      kbd {
        padding: 0 var(--beuve-space-1);
        border: 1px solid var(--beuve-border);
        border-bottom-width: 2px;
        border-radius: 4px;
        background: var(--beuve-surface-sunken);
        font: var(--beuve-font-mono);
        font-size: 10px;
      }
    `,
  ];

  private cases: readonly TraceCase[] = [];
  private casesFor: TraceResultView | undefined;

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const rows = [...this.renderRoot.querySelectorAll<HTMLButtonElement>('button.row')];
    const current = rows.findIndex((row) => row === this.shadowRoot?.activeElement);
    const next = (
      {
        ArrowDown: current + 1,
        ArrowUp: current - 1,
        Home: 0,
        End: rows.length - 1,
      } as Record<string, number | undefined>
    )[event.key];
    if (next === undefined || rows.length === 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const target = rows[Math.min(Math.max(next, 0), rows.length - 1)];
    if (target?.dataset['row'] === undefined) {
      return;
    }

    this.activeRow = target.dataset['row'];
    target.focus();
  };

  @property({ attribute: false }) accessor trace: TraceState | undefined;

  /** The row that takes the arrow keys, as `case:row`. */
  @state() accessor activeRow = '';

  constructor() {
    super();
    // ADR 0074: the timeline's rows, through one listener per type.
    this.addController(
      new ActionDelegation(this, {
        click: {
          row: ({ row = '', line }): void => {
            this.activeRow = row;
            this.activate(Number(line));
          },
        },
        focusin: {
          row: ({ row = '' }): void => {
            this.activeRow = row;
          },
        },
      }),
    );
  }

  private plan(result: TraceResultView): readonly TraceCase[] {
    if (this.casesFor !== result) {
      this.cases = planTraceTimeline(result);
      this.casesFor = result;
    }
    return this.cases;
  }

  private activate(line: number): void {
    const detail: TraceLineActivateDetail = { line };
    this.dispatchEvent(
      new CustomEvent('trace-line-activate', { detail, bubbles: true, composed: true }),
    );
  }

  private fire(name: 'beuve-trace-trust' | 'beuve-trace-close'): void {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }));
  }

  private renderRow(row: TraceRow, key: string): TemplateResult {
    return html`<li>
      <button
        type="button"
        class="row ${row.inHunk ? 'in-hunk' : ''} ${row.tone}"
        data-action="row"
        data-row=${key}
        data-line=${row.line}
        tabindex=${key === this.activeRow ? 0 : -1}
        title=${`Show line ${String(row.line)} in the code`}
        style=${`--depth:${String(row.depth)}`}
      >
        <span class="line">${row.line}</span>
        <span class="indent"></span>
        <span class="tag">${row.tag}</span>
        <span class="text">${row.text}</span>
        ${row.result === '' ? nothing : html`<span class="result ${row.tone}">${row.result}</span>`}
      </button>
    </li>`;
  }

  private renderCase(testCase: TraceCase, caseIndex: number): TemplateResult {
    return html`<section class="case" aria-label=${testCase.title}>
      <div class="case-head">
        <span class="case-title">${testCase.title}</span>
        <span class="status ${testCase.status}">${testCase.status}</span>
        ${testCase.duration === '' ? nothing : html`<span class="duration">${testCase.duration}</span>`}
      </div>
      ${testCase.failure === '' ? nothing : html`<p class="failure">${testCase.failure}</p>`}
      ${
        testCase.rows.length === 0
          ? html`<p class="quiet">This test never reached the traced code.</p>`
          : html`<ol>
              ${testCase.rows.map((row, rowIndex) => {
                return this.renderRow(row, `${String(caseIndex)}:${String(rowIndex)}`);
              })}
            </ol>`
      }
      ${
        testCase.dropped > 0
          ? html`<p class="quiet">${testCase.dropped} more events were not recorded (limit).</p>`
          : nothing
      }
    </section>`;
  }

  private renderReady(result: TraceResultView, note: string | undefined): TemplateResult {
    const cases = this.plan(result);
    return html`
      <p class="summary">${describeTraceSummary(result, cases)}</p>
      ${note === undefined ? nothing : html`<p class="note fail">${note}</p>`}
      ${
        cases.length === 0
          ? html`<p class="note">Vitest ran no tests in ${result.testFiles.join(', ')}.</p>`
          : html`<div class="scroll" @keydown=${this.onKeyDown}>
              ${cases.map((testCase, index) => this.renderCase(testCase, index))}
            </div>`
      }
    `;
  }

  private renderTrust(repositoryPath: string): TemplateResult {
    return html`<div class="prompt" role="alertdialog" aria-labelledby="trust-title">
      <h4 id="trust-title">Run this repository's tests?</h4>
      <p>
        Tracing runs the repository's own test code, and its Vitest configuration, on this machine,
        with your user's access to files and network. Only continue for code you trust.
      </p>
      <p>
        ${repositoryPath === '' ? 'This repository' : html`<code>${pathText(repositoryPath)}</code>`}
        is remembered once you agree; <code>/untrust</code> in the chat withdraws it.
      </p>
      <div class="actions">
        <button
          type="button"
          class="action primary"
          @click=${(): void => {
            this.fire('beuve-trace-trust');
          }}
        >
          Trust and run
        </button>
        <button
          type="button"
          class="action"
          data-cancel
          @click=${(): void => {
            this.fire('beuve-trace-close');
          }}
        >
          Cancel
        </button>
      </div>
    </div>`;
  }

  private renderBody(trace: TraceState): TemplateResult {
    switch (trace.status) {
      case 'loading': {
        return html`<p class="note">
            ${
              trace.testFiles === undefined
                ? 'Choosing the tests…'
                : 'Running the tests with tracing…'
            }
          </p>
          ${
            trace.testFiles === undefined
              ? nothing
              : html`<ul class="files">
                  ${trace.testFiles.map((file) => {
                    return html`<li>${pathText(file)}</li>`;
                  })}
                </ul>`
          }`;
      }
      case 'needs-trust': {
        return this.renderTrust(trace.repositoryPath);
      }
      case 'error': {
        return html`<p class="note error">${trace.message}</p>`;
      }
      case 'ready': {
        return this.renderReady(trace.result, trace.note);
      }
    }
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (!changed.has('trace') || this.trace === undefined) {
      return;
    }
    const previous = changed.get('trace');
    if (this.trace.status === 'needs-trust' && previous?.status !== 'needs-trust') {
      this.renderRoot.querySelector<HTMLButtonElement>('button[data-cancel]')?.focus();
    }
    if (this.trace.status !== 'ready' || previous?.status === 'ready') {
      return;
    }
    const anchor = findAnchorRow(this.plan(this.trace.result));
    if (anchor === undefined) {
      return;
    }
    this.activeRow = `${String(anchor.caseIndex)}:${String(anchor.rowIndex)}`;
    void this.updateComplete.then(() => {
      this.renderRoot
        .querySelector<HTMLButtonElement>(`button[data-row="${CSS.escape(this.activeRow)}"]`)
        ?.focus();
    });
  }

  override render(): TemplateResult {
    const { trace } = this;
    if (trace === undefined) {
      return html``;
    }
    return html`
      <div class="heading" role="heading" aria-level="3">
        <span
          >Trace of the
          hunk${trace.line === undefined ? '' : ` at line ${String(trace.line)}`}</span
        >
        <span class="spacer"></span>
        ${
          trace.status === 'ready'
            ? html`<button
                type="button"
                class="again"
                title=${`Run Again (${shortcutOf('trace', keyPlatformOf(navigator.platform))})`}
                @click=${(): void => {
                  this.dispatchEvent(
                    new CustomEvent('beuve-trace-request', {
                      detail: { path: trace.path, line: trace.line },
                      bubbles: true,
                      composed: true,
                    }),
                  );
                }}
              >
                Run Again
              </button>`
            : nothing
        }
        <button
          type="button"
          class="close"
          title="Close (Esc)"
          aria-label="Close"
          @click=${(): void => {
            this.dispatchEvent(
              new CustomEvent('beuve-trace-close', { bubbles: true, composed: true }),
            );
          }}
        >
          ×
        </button>
      </div>
      ${this.renderBody(trace)}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-trace-portal': BeuveTracePortal;
  }
}
