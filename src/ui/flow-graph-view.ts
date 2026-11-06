import { css, html, LitElement, nothing, svg } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { ActionDelegation } from './action-delegation.ts';
import type { ActionData } from './dispatch-action.ts';
import { withPayload } from './with-payload.ts';
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
 * A small control-flow chart of one function (Show Control Flow, spec 5D): plain text in thin outlines, lines
 * the review changed in the diff "added" colour. Nodes are focusable; arrow keys walk the flow and
 * Enter fires `flow-node-activate` so Zone 2 can jump to the code.
 */
/** Kinds drawn as rounded pills rather than boxes. */
const roundedKinds: ReadonlySet<string> = new Set([
  'condition',
  'loop',
  'switch',
  'case',
  'entry',
  'exit',
]);

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
      max-inline-size: 100%;
      block-size: auto;
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
      font-size: var(--beuve-font-size-caption);
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
      font-family: var(--beuve-font-family-mono);
      font-size: var(--beuve-font-size-caption);
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
      font-size: var(--beuve-font-size-caption);
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
      inline-size: 16px;
      block-size: 10px;
      border: 1px solid var(--beuve-border);
      border-radius: 5px;
    }

    .swatch.changed {
      border-color: var(--beuve-diff-added-bar);
      background: var(--beuve-diff-added-bg);
    }

    .swatch.dashed {
      block-size: 0;
      border-width: 1px 0 0;
      border-style: dashed;
      border-color: var(--beuve-text-muted);
      border-radius: 0;
    }

    .swatch.solid {
      block-size: 0;
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

  constructor() {
    super();
    // ADR 0074: the nodes, through one listener per type.
    const nodeOf = ({ nodeId }: ActionData): FlowViewNode | undefined => {
      return this.graph?.nodes.find((candidate) => String(candidate.id) === nodeId);
    };
    this.addController(
      new ActionDelegation(this, {
        click: {
          node: withPayload(nodeOf, (node): void => {
            this.activate(node);
          }),
        },
        focusin: {
          node: withPayload(nodeOf, (node): void => {
            this.activeId = node.id;
          }),
        },
        keydown: {
          node: withPayload(nodeOf, (node, event: KeyboardEvent): void => {
            this.handleKey(event, node);
          }),
        },
      }),
    );
  }

  private renderEdge(edge: PositionedFlowEdge): TemplateResult {
    const path = `M${edge.points.map((point) => `${String(point.x)} ${String(point.y)}`).join(' L')}`;
    const label = edgeLabels[edge.kind];
    return svg`
      <path class="edge ${edge.kind}${edge.back ? ' back' : ''}" d=${path} marker-end="url(#arrow)"></path>
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
    let radius = 3;
    if (roundedKinds.has(node.kind)) {
      radius = positioned.height / 2;
    }
    const lines = linesOf(node);
    return svg`
      <g
        class="node ${node.kind}${node.changed ? ' changed' : ''}"
        role="button"
        tabindex=${node.id === this.activeId ? 0 : -1}
        data-node-id=${node.id}
        data-action="node"
        aria-label="${node.kind} ${node.label}, ${lines}${node.changed ? ', changed' : ''}"
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
    const nodes = new Map(
      (this.layout?.nodes ?? []).map((node) => {
        return [node.id, node];
      }),
    );
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
        if (parent === undefined) {
          return undefined;
        }
        const siblings = nodes.get(parent)?.successors ?? [];
        const at = siblings.indexOf(id);
        if (key === 'ArrowRight') {
          return siblings[at + 1];
        }
        return siblings[at - 1];
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
    if (this.graph === undefined) {
      this.layout = undefined;
    } else {
      this.layout = flowLayout(this.graph);
    }
    this.activeId = this.graph?.nodes[0]?.id;
  }

  protected override render(): TemplateResult {
    const graph = this.graph;
    const layout = this.layout;
    if (graph === undefined || layout === undefined || graph.nodes.length === 0) {
      return html`<p class="empty">No control flow to show.</p>`;
    }
    const byId = new Map(
      graph.nodes.map((node) => {
        return [node.id, node];
      }),
    );
    return html`
      <svg
        role="group"
        aria-label="Control flow of ${graph.name === '' ? 'the function' : graph.name}"
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

/** `line 4`, or `lines 4 to 9`. */
function linesOf(node: FlowViewNode): string {
  if (node.startLine === node.endLine) {
    return `line ${String(node.startLine)}`;
  }
  return `lines ${String(node.startLine)} to ${String(node.endLine)}`;
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-flow-graph': FlowGraphView;
  }
}
