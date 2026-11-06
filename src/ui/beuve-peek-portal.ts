import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import type { CallHierarchyCallView, CallHierarchyNodeView } from '#contract/ipc-contract.ts';

import { ActionDelegation } from './action-delegation.ts';
import type { PeekState } from './peek-state.ts';
import { formatControlStyles } from './format-control-styles.ts';
import { pathText } from './path-text.ts';

const badgeLabels = { modified: 'Modified', untouched: 'Untouched', external: 'External' };

/**
 * The call-stack peek portal (spec 5D): a lazily expandable tree of the callers of the function
 * a file card's first change sits in, each badged against the review. Presentational: asks for
 * children with `beuve-peek-expand` and closes with `beuve-peek-close`; `beuve-app` does the IPC.
 */
@customElement('beuve-peek-portal')
export class BeuvePeekPortal extends LitElement {
  static override styles = [
    formatControlStyles,
    css`
      :host {
        display: block;
        border-block-end: 1px solid var(--beuve-border);
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
        font-size: var(--beuve-font-size-large);
        line-height: 1;
      }

      .heading {
        display: flex;
        align-items: baseline;
        gap: var(--beuve-space-2);
        padding: var(--beuve-space-2) var(--beuve-space-3) var(--beuve-space-1);
        color: var(--beuve-text-muted);
      }

      .heading code {
        font: var(--beuve-font-mono);
        color: var(--beuve-text);
      }

      .spacer {
        flex: 1;
      }

      ul {
        margin: 0;
        padding-block: 0;
        padding-inline: var(--beuve-space-4) 0;
        list-style: none;
      }

      .tree {
        padding-block: 0 var(--beuve-space-2);
        padding-inline: 0 var(--beuve-space-3);
      }

      .row {
        display: flex;
        align-items: center;
        gap: var(--beuve-space-2);
        inline-size: 100%;
        padding: 2px var(--beuve-space-1);
        border: 0;
        border-radius: var(--beuve-radius-small);
        background: none;
        color: var(--beuve-text);
        font: var(--beuve-font-small);
        text-align: start;
        cursor: pointer;
      }

      .row:hover,
      .row:focus-visible {
        background: var(--beuve-accent-soft);
        outline: none;
      }

      .twisty {
        inline-size: 1em;
        color: var(--beuve-text-muted);
      }

      .name {
        font: var(--beuve-font-mono);
      }

      .where {
        overflow: hidden;
        color: var(--beuve-text-muted);
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      li {
        position: relative;
      }

      li > .row {
        padding-inline-end: 52px;
      }

      .open {
        position: absolute;
        inset-block-start: 2px;
        inset-inline-end: 0;
        padding: 0 var(--beuve-space-2);
        border: 1px solid var(--beuve-border);
        border-radius: var(--beuve-radius-small);
        background: var(--beuve-surface);
        color: var(--beuve-text-muted);
        font: var(--beuve-font-small);
        cursor: pointer;
        opacity: 0;
      }

      li:hover > .open,
      .open:focus-visible {
        opacity: 1;
      }

      .badge {
        margin-inline-start: auto;
        padding: 0 var(--beuve-space-1);
        border: 1px solid var(--beuve-border);
        border-radius: var(--beuve-radius-small);
        color: var(--beuve-text-muted);
      }

      .badge.modified {
        border-color: var(--beuve-warn);
        color: var(--beuve-warn);
      }

      .badge.external {
        border-style: dashed;
      }

      .note {
        padding-block: 2px;
        padding-inline: var(--beuve-space-6) var(--beuve-space-1);
        color: var(--beuve-text-muted);
      }

      .note.error {
        color: var(--beuve-danger);
      }

      kbd {
        padding: 0 var(--beuve-space-1);
        border: 1px solid var(--beuve-border);
        border-block-end-width: 2px;
        border-radius: var(--beuve-radius-small);
        background: var(--beuve-surface-sunken);
        font: var(--beuve-font-mono);
        font-size: var(--beuve-font-size-caption);
      }
    `,
  ];

  /** The nodes the last render showed, by id, for the delegated actions to act on. */
  private readonly shownNodes = new Map<string, CallHierarchyNodeView>();

  @property({ attribute: false }) accessor peek: PeekState | undefined;

  /** Expanded node ids; the root is always expanded. */
  @state() accessor expanded: ReadonlySet<string> = new Set();

  constructor() {
    super();
    // ADR 0074: the tree's rows and Open buttons, through one listener.
    this.addController(
      new ActionDelegation(this, {
        click: {
          toggle: ({ nodeId = '' }): void => {
            const node = this.shownNodes.get(nodeId);
            if (node !== undefined) {
              this.toggle(node);
            }
          },
          open: ({ nodeId = '' }): void => {
            const node = this.shownNodes.get(nodeId);
            if (node !== undefined) {
              this.openDefinition(node);
            }
          },
        },
      }),
    );
  }

  private toggle(node: CallHierarchyNodeView): void {
    const next = new Set(this.expanded);
    if (next.delete(node.id)) {
      this.expanded = next;
      return;
    }
    next.add(node.id);
    this.expanded = next;
    if (this.peek?.status === 'ready' && !this.peek.children.has(node.id)) {
      this.dispatchEvent(
        new CustomEvent('beuve-peek-expand', {
          detail: { nodeId: node.id },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  private renderBody(peek: PeekState): TemplateResult {
    switch (peek.status) {
      case 'loading': {
        return html`<p class="note">Asking the language server…</p>`;
      }
      case 'error': {
        return html`<p class="note error">${peek.message}</p>`;
      }
      case 'ready': {
        return html`<div class="tree" role="tree">
          <ul>
            ${this.renderNode(peek.root, [], true)}
          </ul>
        </div>`;
      }
    }
  }

  private renderNode(
    node: CallHierarchyNodeView,
    callSiteLines: readonly number[],
    isRoot = false,
  ): TemplateResult {
    const isOpen = isRoot || this.expanded.has(node.id);
    this.shownNodes.set(node.id, node);
    return html`<li role="treeitem" aria-expanded=${isOpen ? 'true' : 'false'}>
      <button
        type="button"
        class="row"
        ?disabled=${isRoot}
        data-action="toggle"
        data-node-id=${node.id}
      >
        <span class="twisty">${isOpen ? '▾' : '▸'}</span>
        <span class="name">${pathText(node.name)}</span>
        <span class="where">${pathText(location(node, callSiteLines))}</span>
        <span class="badge ${node.badge}">${badgeLabels[node.badge]}</span>
      </button>
      ${node.file.kind === 'workspace' ? this.renderOpen(node) : nothing}
      ${isOpen ? this.renderChildren(node) : nothing}
    </li>`;
  }

  /** Opens the node's declaration in a sheet (ADR 0067); `beuve-app` decides window or overlay. */
  private renderOpen(node: CallHierarchyNodeView): TemplateResult {
    return html`<button
      type="button"
      class="open"
      title="Open the definition in a sheet"
      data-action="open"
      data-node-id=${node.id}
    >
      Open
    </button>`;
  }

  private openDefinition(node: CallHierarchyNodeView): void {
    const { file } = node;
    if (file.kind !== 'workspace') {
      return;
    }
    this.dispatchEvent(
      new CustomEvent('beuve-sheet-request', {
        detail: {
          path: file.path,
          range: {
            startLine: node.selectionLine,
            startCharacter: 0,
            endLine: node.endLine,
            endCharacter: 0,
          },
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private renderChildren(node: CallHierarchyNodeView): TemplateResult {
    if (this.peek?.status !== 'ready') {
      return html`<p class="note">Loading callers…</p>`;
    }
    const children = this.peek.children.get(node.id);
    if (children === undefined || children.status === 'loading') {
      return html`<p class="note">Loading callers…</p>`;
    }
    if (children.status === 'error') {
      return html`<p class="note error">${children.message}</p>`;
    }
    if (children.calls.length === 0) {
      return html`<p class="note">No callers found.</p>`;
    }
    return html`<ul role="group">
      ${children.calls.map((call: CallHierarchyCallView) => {
        return this.renderNode(call.node, call.callSiteLines);
      })}
    </ul>`;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    const previous = changed.get('peek');
    if (changed.has('peek') && rootId(previous) !== rootId(this.peek)) {
      this.expanded = new Set();
    }
  }

  override render(): TemplateResult {
    const { peek } = this;
    if (peek === undefined) {
      return html``;
    }
    this.shownNodes.clear();
    return html`
      <div class="heading" role="heading" aria-level="3">
        <span
          >Callers of
          ${
            peek.status === 'ready' ? html`<code>${pathText(peek.root.name)}</code>` : 'the change'
          }</span
        >
        <span class="spacer"></span>
        <button
          type="button"
          class="close"
          title="Close (Esc)"
          aria-label="Close"
          @click=${(): void => {
            this.dispatchEvent(
              new CustomEvent('beuve-peek-close', { bubbles: true, composed: true }),
            );
          }}
        >
          ×
        </button>
      </div>
      ${this.renderBody(peek)}
    `;
  }
}

function rootId(peek: PeekState | undefined): string | undefined {
  if (peek?.status === 'ready') {
    return peek.root.id;
  }
  return undefined;
}

function location(node: CallHierarchyNodeView, callSiteLines: readonly number[]): string {
  const at = `${node.kind} · ${fileOf(node)}:${String(node.selectionLine)}`;
  if (callSiteLines.length === 0) {
    return at;
  }
  return `${at} · calls at ${callSiteLines.join(', ')}`;
}

function fileOf(node: CallHierarchyNodeView): string {
  if (node.file.kind === 'workspace') {
    return node.file.path;
  }
  return node.file.uri;
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-peek-portal': BeuvePeekPortal;
  }
}
