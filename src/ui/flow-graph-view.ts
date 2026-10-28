import { css, html, LitElement, nothing, svg } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { flowLayout } from './flow-layout.ts';
import type {
  FlowLayout,
  FlowLayoutEdge,
  FlowLayoutNode,
  PositionedFlowEdge,
  PositionedFlowNode,
} from './flow-layout.ts';

/** A node of the graph to draw; the flow domain's graph nodes satisfy it structurally. */
export interface FlowViewNode extends FlowLayoutNode {
  readonly startLine: number;
  readonly endLine: number;
  readonly changed: boolean;
}

/** The graph to draw (ADR 0028). */
export interface FlowViewGraph {
  readonly name: string;
  readonly nodes: readonly FlowViewNode[];
  readonly edges: readonly FlowLayoutEdge[];
}

/** Detail of `flow-node-activate`: where in the file the activated node lives (one-based lines). */
export interface FlowNodeActivateDetail {
  readonly nodeId: number;
  readonly startLine: number;
  readonly endLine: number;
}

const edgeLabels: Readonly<Record<string, string | undefined>> = {
  true: 'yes',
  false: 'no',
  default: 'default',
  exception: 'throws',
  finally: 'finally',
  break: 'break',
  continue: 'continue',
};

const markers: Readonly<Record<string, string | undefined>> = {
  condition: '?',
  loop: '↻',
  switch: '⇄',
};

/**
 * A small control-flow chart of one function (Shift+p, spec 5D): plain text in thin outlines, lines
 * the review changed in the diff "added" colour. Nodes are focusable; arrow keys walk the flow and
 * Enter fires `flow-node-activate` so Zone 2 can jump to the code.
 */
@customElement('beuve-flow-graph')
export class FlowGraphView extends LitElement {
  static override styles = css`
    :host {
      display: block;
      overflow: auto;
      background: var(--beuve-bg);
      color: var(--beuve-text);
      font: var(--beuve-font-small);
    }

    svg {
      display: block;
      max-width: 100%;
      height: auto;
    }

    .edge {
      fill: none;
      stroke: var(--beuve-text-muted);
      stroke-width: 1;
    }

    .edge.back,
    .edge.continue,
    .edge.break,
    .edge.exception,
    .edge.finally {
      stroke-dasharray: 4 3;
    }

    .edge.exception {
      stroke: var(--beuve-danger);
    }

    .arrow {
      fill: var(--beuve-text-muted);
    }

    .edge-label {
      fill: var(--beuve-text-muted);
      font-size: 10px;
      paint-order: stroke;
      stroke: var(--beuve-bg);
      stroke-width: 3px;
      stroke-linejoin: round;
    }

    .node {
      cursor: pointer;
      outline: none;
    }

    .shape {
      fill: var(--beuve-code-bg, var(--beuve-surface));
      stroke: var(--beuve-border);
      stroke-width: 1;
    }

    .node.entry .shape,
    .node.exit .shape {
      fill: none;
      stroke-dasharray: 2 2;
    }

    .node.return .shape,
    .node.throw .shape {
      stroke: var(--beuve-text-muted);
    }

    .node.throw .shape {
      stroke: var(--beuve-danger);
    }

    .node.changed .shape {
      fill: var(--beuve-diff-added-bg);
      stroke: var(--beuve-diff-added-bar);
      stroke-width: 1.5;
    }

    .node:hover .shape {
      stroke: var(--beuve-accent);
    }

    .node:focus-visible .shape {
      stroke: var(--beuve-accent);
      stroke-width: 2;
    }

    .bar {
      stroke: var(--beuve-diff-added-bar);
      stroke-width: 3;
      stroke-linecap: round;
    }

    .label {
      fill: var(--beuve-code-text, var(--beuve-text));
      font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
      font-size: 11px;
      dominant-baseline: central;
      pointer-events: none;
    }

    .node.changed .label {
      fill: var(--beuve-diff-added-text);
    }

    .node.entry .label,
    .node.exit .label {
      fill: var(--beuve-text-muted);
    }

    .marker {
      fill: var(--beuve-accent);
      font-size: 11px;
      dominant-baseline: central;
      pointer-events: none;
    }

    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: var(--beuve-space-1) var(--beuve-space-4);
      margin: var(--beuve-space-2) 0 0;
      padding: 0;
      list-style: none;
      color: var(--beuve-text-muted);
    }

    .legend li {
      display: inline-flex;
      align-items: center;
      gap: var(--beuve-space-1);
    }

    .swatch {
      display: inline-block;
      width: 16px;
      height: 10px;
      border: 1px solid var(--beuve-border);
      border-radius: 5px;
    }

    .swatch.changed {
      border-color: var(--beuve-diff-added-bar);
      background: var(--beuve-diff-added-bg);
    }

    .swatch.dashed {
      height: 0;
      border-width: 1px 0 0;
      border-style: dashed;
      border-color: var(--beuve-text-muted);
      border-radius: 0;
    }

    .swatch.solid {
      height: 0;
      border-width: 1px 0 0;
      border-color: var(--beuve-text-muted);
      border-radius: 0;
    }

    .accent {
      color: var(--beuve-accent);
    }

    .empty {
      margin: 0;
      color: var(--beuve-text-muted);
    }
  `;

  private layout: FlowLayout | undefined;

  @property({ attribute: false }) accessor graph: FlowViewGraph | undefined;
  @state() accessor activeId: number | undefined;

  private renderEdge(edge: PositionedFlowEdge): TemplateResult {
    const path = edge.points
      .map((point, at) => `${at === 0 ? 'M' : 'L'}${String(point.x)} ${String(point.y)}`)
      .join(' ');
    const label = edgeLabels[edge.kind];
    return svg`
      <path class=${`edge ${edge.kind}${edge.back ? ' back' : ''}`} d=${path} marker-end="url(#arrow)"></path>
      ${label === undefined ? nothing : svg`<text class="edge-label" text-anchor=${edge.labelAnchor} x=${edge.labelAt.x} y=${edge.labelAt.y}>${label}</text>`}
    `;
  }

  private renderNode(
    positioned: PositionedFlowNode,
    node: FlowViewNode | undefined,
  ): TemplateResult {
    if (node === undefined) {
      return svg``;
    }
    const marker = markers[node.kind];
    const radius = ['condition', 'loop', 'switch', 'case', 'entry', 'exit'].includes(node.kind)
      ? positioned.height / 2
      : 3;
    const lines =
      node.startLine === node.endLine
        ? `line ${String(node.startLine)}`
        : `lines ${String(node.startLine)} to ${String(node.endLine)}`;
    return svg`
      <g
        class=${`node ${node.kind}${node.changed ? ' changed' : ''}`}
        role="button"
        tabindex=${node.id === this.activeId ? 0 : -1}
        data-node-id=${node.id}
        aria-label=${`${node.kind} ${node.label}, ${lines}${node.changed ? ', changed' : ''}`}
        @click=${(): void => {
          this.activate(node);
        }}
        @focus=${(): void => {
          this.activeId = node.id;
        }}
        @keydown=${(event: KeyboardEvent): void => {
          this.handleKey(event, node);
        }}
      >
        <title>${lines}</title>
        <rect
          class="shape"
          x=${positioned.x}
          y=${positioned.y}
          width=${positioned.width}
          height=${positioned.height}
          rx=${radius}
        ></rect>
        ${
          node.changed
            ? svg`<line class="bar" x1=${positioned.x + 5} y1=${positioned.y + 8} x2=${positioned.x + 5} y2=${positioned.y + positioned.height - 8}></line>`
            : nothing
        }
        ${
          marker === undefined
            ? nothing
            : svg`<text class="marker" x=${positioned.x + 12} y=${positioned.y + positioned.height / 2}>${marker}</text>`
        }
        <text class="label" x=${positioned.x + (marker === undefined ? 14 : 26)} y=${positioned.y + positioned.height / 2}>${node.label}</text>
      </g>
    `;
  }

  private renderLegend(): TemplateResult {
    return html`
      <ul class="legend" aria-label="Legend">
        <li><span class="swatch changed"></span>changed in review</li>
        <li><span class="swatch"></span>step</li>
        <li><span class="accent">?</span> branch</li>
        <li><span class="accent">↻</span> loop</li>
        <li><span class="swatch solid"></span>flow</li>
        <li><span class="swatch dashed"></span>jump or loop-back</li>
      </ul>
    `;
  }

  private handleKey(event: KeyboardEvent, node: FlowViewNode): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.activate(node);
      return;
    }
    const target = this.neighbour(event.key, node.id);
    if (target === undefined) {
      return;
    }
    event.preventDefault();
    this.focusNode(target);
  }

  /** Down and up follow the flow; left and right step between the branches of the same decision. */
  private neighbour(key: string, id: number): number | undefined {
    const nodes = new Map((this.layout?.nodes ?? []).map((node) => [node.id, node]));
    const current = nodes.get(id);
    switch (key) {
      case 'ArrowDown': {
        return current?.successors[0];
      }
      case 'ArrowUp': {
        return current?.predecessors[0];
      }
      case 'ArrowLeft':
      case 'ArrowRight': {
        const parent = current?.predecessors[0];
        const siblings = parent === undefined ? [] : (nodes.get(parent)?.successors ?? []);
        const at = siblings.indexOf(id);
        return siblings[at + (key === 'ArrowRight' ? 1 : -1)];
      }
      default: {
        return undefined;
      }
    }
  }

  private focusNode(id: number): void {
    this.activeId = id;
    void this.updateComplete.then(() => {
      this.renderRoot
        .querySelector<SVGElement>(`[data-node-id="${CSS.escape(String(id))}"]`)
        ?.focus();
    });
  }

  private activate(node: FlowViewNode): void {
    const detail: FlowNodeActivateDetail = {
      nodeId: node.id,
      startLine: node.startLine,
      endLine: node.endLine,
    };
    this.dispatchEvent(
      new CustomEvent('flow-node-activate', { detail, bubbles: true, composed: true }),
    );
  }

  /** Puts keyboard focus on the first node (the entry), once the chart has rendered. */
  focusEntry(): void {
    const first = this.graph?.nodes[0]?.id;
    if (first !== undefined) {
      this.focusNode(first);
    }
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has('graph')) {
      return;
    }
    this.layout = this.graph === undefined ? undefined : flowLayout(this.graph);
    this.activeId = this.graph?.nodes[0]?.id;
  }

  protected override render(): TemplateResult {
    const graph = this.graph;
    const layout = this.layout;
    if (graph === undefined || layout === undefined || graph.nodes.length === 0) {
      return html`<p class="empty">No control flow to show.</p>`;
    }
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    return html`
      <svg
        role="group"
        aria-label=${`Control flow of ${graph.name === '' ? 'the function' : graph.name}`}
        width=${layout.width}
        height=${layout.height}
        viewBox=${`0 0 ${String(layout.width)} ${String(layout.height)}`}
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path class="arrow" d="M0 0 L8 4 L0 8 z"></path>
          </marker>
        </defs>
        ${layout.edges.map((edge) => this.renderEdge(edge))}
        ${layout.nodes.map((positioned) => this.renderNode(positioned, byId.get(positioned.id)))}
      </svg>
      ${this.renderLegend()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-flow-graph': FlowGraphView;
  }
}
