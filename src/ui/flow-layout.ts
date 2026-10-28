/** A node to place: the part of a control-flow graph node the layout reads. */
export interface FlowLayoutNode {
  readonly id: number;
  readonly kind: string;
  readonly label: string;
}

/** An edge to route. `loop-back` edges are always treated as back edges. */
export interface FlowLayoutEdge {
  readonly from: number;
  readonly to: number;
  readonly kind: string;
}

export interface FlowLayoutInput {
  readonly nodes: readonly FlowLayoutNode[];
  readonly edges: readonly FlowLayoutEdge[];
}

export interface FlowPoint {
  readonly x: number;
  readonly y: number;
}

export interface PositionedFlowNode {
  readonly id: number;
  /** Top-left corner. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly layer: number;
  /** Forward targets and sources, left to right: what the arrow keys walk. */
  readonly successors: readonly number[];
  readonly predecessors: readonly number[];
}

export interface PositionedFlowEdge {
  readonly from: number;
  readonly to: number;
  readonly kind: string;
  /** The edge climbs back to an earlier node, along the right-hand side of the graph. */
  readonly back: boolean;
  /** An orthogonal polyline from the source to the target (the last segment ends in the arrow). */
  readonly points: readonly FlowPoint[];
  /** Where to write the edge's label: beside its first bend, clear of the line itself. */
  readonly labelAt: FlowPoint;
  /** Which side of `labelAt` the text grows towards, so it never sits on the line. */
  readonly labelAnchor: 'start' | 'end';
}

export interface FlowLayout {
  readonly width: number;
  readonly height: number;
  readonly nodes: readonly PositionedFlowNode[];
  readonly edges: readonly PositionedFlowEdge[];
}

const margin = 16;
const nodeHeight = 28;
const layerGap = 38;
const nodeGap = 24;
const dummyWidth = 8;
const laneGap = 16;
const charWidth = 6.7;
const labelPadding = 28;
const markerWidth = 14;
const minWidth = 56;
const maxWidth = 340;
const sweeps = 4;
const markedKinds = new Set(['condition', 'loop', 'switch']);

/**
 * A deterministic layered layout for small control-flow graphs (ADR 0028), with no dependencies:
 * back edges are set aside, layers come from the longest path from the entry, barycenter sweeps
 * order each layer, nodes are spread to sit under their neighbours, and back edges run down a
 * lane on the right. The same input always gives the same output.
 */
export function flowLayout(input: FlowLayoutInput): FlowLayout {
  const count = input.nodes.length;
  if (count === 0) {
    return { width: margin * 2, height: margin * 2, nodes: [], edges: [] };
  }
  const index = new Map(input.nodes.map((node, position) => [node.id, position]));
  const edges: IndexedEdge[] = [];
  for (const edge of input.edges) {
    const from = index.get(edge.from);
    const to = index.get(edge.to);
    if (from !== undefined && to !== undefined && from !== to) {
      edges.push({ from, to, kind: edge.kind, source: edge });
    }
  }
  const back = findBackEdges(input.nodes, edges);
  const forward = edges.filter((_, position) => !back.has(position));
  const layerOf = assignLayers(input.nodes, forward);
  const graph = buildLayeredGraph(input.nodes, forward, layerOf);
  orderLayers(graph);
  placeHorizontally(graph);
  return buildResult(input.nodes, edges, back, graph, layerOf);
}

interface IndexedEdge {
  readonly from: number;
  readonly to: number;
  readonly kind: string;
  readonly source: FlowLayoutEdge;
}

/** Real nodes are `0..count-1`; dummy nodes that carry long edges across layers come after. */
interface LayeredGraph {
  readonly count: number;
  readonly layer: number[];
  readonly width: number[];
  readonly layers: number[][];
  /** Adjacent-layer links, per node. */
  readonly up: number[][];
  readonly down: number[][];
  /** For each forward edge, the chain from source to target through its dummies. */
  readonly chains: number[][];
  readonly center: number[];
}

function findBackEdges(
  nodes: readonly FlowLayoutNode[],
  edges: readonly IndexedEdge[],
): Set<number> {
  const back = new Set<number>();
  const outgoing: number[][] = nodes.map(() => []);
  for (const [position, edge] of edges.entries()) {
    if (edge.kind === 'loop-back') {
      back.add(position);
    } else {
      outgoing[edge.from]?.push(position);
    }
  }
  const state = nodes.map(() => 0);
  const roots = [
    ...indices(nodes.length).filter((position) => nodes[position]?.kind === 'entry'),
    ...indices(nodes.length),
  ];
  for (const root of roots) {
    if (state[root] === 0) {
      visitDepthFirst(root, edges, outgoing, state, back);
    }
  }
  return back;
}

function visitDepthFirst(
  root: number,
  edges: readonly IndexedEdge[],
  outgoing: readonly (readonly number[])[],
  state: number[],
  back: Set<number>,
): void {
  const stack: { node: number; next: number }[] = [{ node: root, next: 0 }];
  state[root] = 1;
  for (let top = stack.at(-1); top !== undefined; top = stack.at(-1)) {
    const edgeIndex = outgoing[top.node]?.[top.next];
    if (edgeIndex === undefined) {
      state[top.node] = 2;
      stack.pop();
      continue;
    }
    top.next++;
    const target = edges[edgeIndex]?.to ?? top.node;
    if (state[target] === 1) {
      back.add(edgeIndex);
    } else if (state[target] === 0) {
      state[target] = 1;
      stack.push({ node: target, next: 0 });
    }
  }
}

function assignLayers(nodes: readonly FlowLayoutNode[], forward: readonly IndexedEdge[]): number[] {
  const layer = nodes.map(() => 0);
  const incoming = nodes.map(() => 0);
  for (const edge of forward) {
    incoming[edge.to] = (incoming[edge.to] ?? 0) + 1;
  }
  const ready = indices(nodes.length).filter((position) => incoming[position] === 0);
  let head = 0;
  while (head < ready.length) {
    const node = ready[head] ?? 0;
    head++;
    for (const edge of forward) {
      if (edge.from !== node) {
        continue;
      }
      layer[edge.to] = Math.max(layer[edge.to] ?? 0, (layer[node] ?? 0) + 1);
      incoming[edge.to] = (incoming[edge.to] ?? 1) - 1;
      if (incoming[edge.to] === 0) {
        ready.push(edge.to);
      }
    }
  }
  const last = Math.max(0, ...layer.filter((_, position) => nodes[position]?.kind !== 'exit'));
  for (const [position, node] of nodes.entries()) {
    if (node.kind === 'exit') {
      layer[position] = last + 1;
    }
  }
  return layer;
}

function buildLayeredGraph(
  nodes: readonly FlowLayoutNode[],
  forward: readonly IndexedEdge[],
  layerOf: readonly number[],
): LayeredGraph {
  const layer = [...layerOf];
  const width = nodes.map((node) => estimateWidth(node));
  const up: number[][] = nodes.map(() => []);
  const down: number[][] = nodes.map(() => []);
  const chains: number[][] = [];
  for (const edge of forward) {
    const chain = [edge.from];
    const span = (layer[edge.to] ?? 0) - (layer[edge.from] ?? 0);
    for (let step = 1; step < span; step++) {
      layer.push((layer[edge.from] ?? 0) + step);
      width.push(dummyWidth);
      up.push([]);
      down.push([]);
      chain.push(layer.length - 1);
    }
    chain.push(edge.to);
    for (let hop = 1; hop < chain.length; hop++) {
      const upper = chain[hop - 1] ?? 0;
      const lower = chain[hop] ?? 0;
      down[upper]?.push(lower);
      up[lower]?.push(upper);
    }
    chains.push(chain);
  }
  const layers: number[][] = [];
  for (const [position, value] of layer.entries()) {
    (layers[value] ??= []).push(position);
  }
  for (let value = 0; value < layers.length; value++) {
    layers[value] ??= [];
  }
  return {
    count: nodes.length,
    layer,
    width,
    layers,
    up,
    down,
    chains,
    center: layer.map(() => 0),
  };
}

function estimateWidth(node: FlowLayoutNode): number {
  const marker = markedKinds.has(node.kind) ? markerWidth : 0;
  const estimate = Math.round(node.label.length * charWidth) + labelPadding + marker;
  return Math.min(maxWidth, Math.max(minWidth, estimate));
}

function orderLayers(graph: LayeredGraph): void {
  for (let sweep = 0; sweep < sweeps; sweep++) {
    const isDownward = sweep % 2 === 0;
    const order = sweepOrder(graph.layers.length, isDownward);
    for (const value of order) {
      const layer = graph.layers[value];
      if (layer === undefined) {
        continue;
      }
      const positions = new Map<number, number>();
      for (const [at, node] of layer.entries()) {
        positions.set(node, at);
      }
      const neighbourLayer = graph.layers[value + (isDownward ? -1 : 1)];
      if (neighbourLayer === undefined) {
        continue;
      }
      const neighbourPosition = new Map(neighbourLayer.map((node, at) => [node, at]));
      const links = isDownward ? graph.up : graph.down;
      const keyed = layer.map((node) => {
        const at = (links[node] ?? [])
          .map((other) => neighbourPosition.get(other))
          .filter((found) => found !== undefined);
        const mean = at.length === 0 ? (positions.get(node) ?? 0) : average(at);
        return { node, mean, at: positions.get(node) ?? 0 };
      });
      keyed.sort((left, right) => left.mean - right.mean || left.at - right.at);
      graph.layers[value] = keyed.map((item) => item.node);
    }
  }
}

function placeHorizontally(graph: LayeredGraph): void {
  const rowWidths = graph.layers.map((layer) =>
    layer.reduce((sum, node) => sum + (graph.width[node] ?? 0) + nodeGap, -nodeGap),
  );
  const widest = Math.max(...rowWidths);
  for (const [value, layer] of graph.layers.entries()) {
    let left = (widest - (rowWidths[value] ?? 0)) / 2;
    for (const node of layer) {
      graph.center[node] = left + (graph.width[node] ?? 0) / 2;
      left += (graph.width[node] ?? 0) + nodeGap;
    }
  }
  for (let sweep = 0; sweep < sweeps * 2; sweep++) {
    const isDownward = sweep % 2 === 0;
    const order = sweepOrder(graph.layers.length, isDownward);
    for (const value of order) {
      const links = isDownward ? graph.up : graph.down;
      spreadLayer(graph, graph.layers[value] ?? [], links);
    }
  }
}

/** Moves each node of a layer towards its neighbours, then removes overlaps from both sides. */
function spreadLayer(
  graph: LayeredGraph,
  layer: readonly number[],
  links: readonly (readonly number[])[],
): void {
  const desired = layer.map((node) => {
    const centers = (links[node] ?? []).map((other) => graph.center[other] ?? 0);
    return centers.length === 0 ? (graph.center[node] ?? 0) : average(centers);
  });
  const separation = (at: number): number =>
    ((graph.width[layer[at] ?? 0] ?? 0) + (graph.width[layer[at + 1] ?? 0] ?? 0)) / 2 + nodeGap;
  const leftPacked = [...desired];
  for (let at = 1; at < layer.length; at++) {
    leftPacked[at] = Math.max(leftPacked[at] ?? 0, (leftPacked[at - 1] ?? 0) + separation(at - 1));
  }
  const rightPacked = [...desired];
  for (let at = layer.length - 2; at >= 0; at--) {
    rightPacked[at] = Math.min(rightPacked[at] ?? 0, (rightPacked[at + 1] ?? 0) - separation(at));
  }
  for (const [at, node] of layer.entries()) {
    graph.center[node] = ((leftPacked[at] ?? 0) + (rightPacked[at] ?? 0)) / 2;
  }
}

function buildResult(
  nodes: readonly FlowLayoutNode[],
  edges: readonly IndexedEdge[],
  back: ReadonlySet<number>,
  graph: LayeredGraph,
  layerOf: readonly number[],
): FlowLayout {
  const shift =
    margin - Math.min(...graph.center.map((center, node) => center - (graph.width[node] ?? 0) / 2));
  const boxes = graph.center.map((center, node) => {
    const width = graph.width[node] ?? 0;
    return {
      x: center + shift - width / 2,
      y: margin + (graph.layer[node] ?? 0) * (nodeHeight + layerGap),
      width,
    };
  });
  const forward = edges
    .map((edge, position) => ({ edge, position }))
    .filter(({ position }) => !back.has(position));
  const ports = assignPorts(
    forward.map(({ edge }) => edge),
    graph,
    boxes,
  );
  const positioned = nodes.map((node, position) => {
    const box = boxes[position] ?? { x: 0, y: 0, width: 0 };
    return {
      id: node.id,
      x: box.x,
      y: box.y,
      width: box.width,
      height: nodeHeight,
      layer: layerOf[position] ?? 0,
      successors: neighbours(
        position,
        forward.map(({ edge }) => edge),
        'to',
        boxes,
        nodes,
      ),
      predecessors: neighbours(
        position,
        forward.map(({ edge }) => edge),
        'from',
        boxes,
        nodes,
      ),
    };
  });
  const maxRight = Math.max(...boxes.slice(0, graph.count).map((box) => box.x + box.width));
  const lanes = laneOrder(edges, back, layerOf);
  const routed: (PositionedFlowEdge | undefined)[] = edges.map((edge, position) => {
    if (back.has(position)) {
      return routeBack(edge, lanes.get(position) ?? 0, boxes, maxRight, graph.count);
    }
    const slot = forward.findIndex((item) => item.position === position);
    return routeForward(edge, graph.chains[slot] ?? [], ports.get(slot), boxes, slot);
  });
  const right = maxRight + (lanes.size === 0 ? 0 : (lanes.size + 1) * laneGap);
  const bottom = Math.max(...boxes.slice(0, graph.count).map((box) => box.y)) + nodeHeight;
  return {
    width: Math.ceil(right + margin),
    height: Math.ceil(bottom + margin),
    nodes: positioned,
    edges: routed.filter((edge) => edge !== undefined),
  };
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

interface EdgePorts {
  readonly out: number;
  readonly in: number;
}

/** Spreads the edges leaving and entering a node along its width, ordered to avoid crossings. */
function assignPorts(
  forward: readonly IndexedEdge[],
  graph: LayeredGraph,
  boxes: readonly Box[],
): Map<number, EdgePorts> {
  const centerOf = (node: number): number => (boxes[node]?.x ?? 0) + (boxes[node]?.width ?? 0) / 2;
  const outs = new Map<number, number>();
  const ins = new Map<number, number>();
  const leaving = new Map<number, number[]>();
  const entering = new Map<number, number[]>();
  for (const [slot, edge] of forward.entries()) {
    const chain = graph.chains[slot] ?? [];
    (leaving.get(edge.from) ?? leaving.set(edge.from, []).get(edge.from))?.push(slot);
    (entering.get(edge.to) ?? entering.set(edge.to, []).get(edge.to))?.push(slot);
    outs.set(slot, centerOf(chain[1] ?? edge.to));
    ins.set(slot, centerOf(chain.at(-2) ?? edge.from));
  }
  const result = new Map<number, EdgePorts>();
  const outPort = spreadPorts(leaving, outs, boxes);
  const inPort = spreadPorts(entering, ins, boxes);
  for (let slot = 0; slot < forward.length; slot++) {
    result.set(slot, { out: outPort.get(slot) ?? 0, in: inPort.get(slot) ?? 0 });
  }
  return result;
}

function spreadPorts(
  slotsByNode: ReadonlyMap<number, readonly number[]>,
  towards: ReadonlyMap<number, number>,
  boxes: readonly Box[],
): Map<number, number> {
  const ports = new Map<number, number>();
  for (const [node, slots] of slotsByNode) {
    const box = boxes[node] ?? { x: 0, y: 0, width: 0 };
    const ordered = slots.toSorted(
      (left, right) => (towards.get(left) ?? 0) - (towards.get(right) ?? 0) || left - right,
    );
    const step = ordered.length > 1 ? Math.min(18, (box.width - 20) / (ordered.length - 1)) : 0;
    for (const [at, slot] of ordered.entries()) {
      ports.set(slot, box.x + box.width / 2 + (at - (ordered.length - 1) / 2) * step);
    }
  }
  return ports;
}

function routeForward(
  edge: IndexedEdge,
  chain: readonly number[],
  ports: EdgePorts | undefined,
  boxes: readonly Box[],
  slot: number,
): PositionedFlowEdge {
  const source = boxes[edge.from] ?? { x: 0, y: 0, width: 0 };
  const target = boxes[edge.to] ?? { x: 0, y: 0, width: 0 };
  const hops: FlowPoint[] = [{ x: ports?.out ?? source.x, y: source.y + nodeHeight }];
  const dummies = chain.slice(1, -1);
  for (const dummy of dummies) {
    const box = boxes[dummy] ?? { x: 0, y: 0, width: 0 };
    const x = box.x + box.width / 2;
    hops.push({ x, y: box.y }, { x, y: box.y + nodeHeight });
  }
  hops.push({ x: ports?.in ?? target.x, y: target.y });
  const points: FlowPoint[] = [];
  for (let hop = 1; hop < hops.length; hop++) {
    const from = hops[hop - 1] ?? { x: 0, y: 0 };
    const to = hops[hop] ?? from;
    const middle = (from.y + to.y) / 2 + stagger(slot);
    points.push(from, { x: from.x, y: middle }, { x: to.x, y: middle });
  }
  points.push(hops.at(-1) ?? { x: 0, y: 0 });
  const simple = simplify(points);
  return {
    from: edge.source.from,
    to: edge.source.to,
    kind: edge.kind,
    back: false,
    points: simple,
    ...placeForwardLabel(simple),
  };
}

/**
 * The label goes on the first horizontal run, above it and on the side the run heads to, so the
 * two labels of a decision (`yes` left, `no` right) diverge instead of colliding. An edge that
 * starts by running straight down gets its label beside that run.
 */
function placeForwardLabel(points: readonly FlowPoint[]): {
  labelAt: FlowPoint;
  labelAnchor: 'start' | 'end';
} {
  const [start = { x: 0, y: 0 }, bend = start, turn = bend] = points;
  const direction = Math.sign(turn.x - bend.x);
  if (direction === 0 || bend.x !== start.x) {
    return { labelAt: { x: start.x + 4, y: start.y + 12 }, labelAnchor: 'start' };
  }
  return {
    labelAt: { x: bend.x + direction * 4, y: bend.y - 4 },
    labelAnchor: direction < 0 ? 'end' : 'start',
  };
}

/**
 * Back edges climb a lane right of the drawing. They leave and enter through a node's right side
 * when nothing else sits on that side of its row; otherwise they leave through the bottom and
 * enter through the top, along the gaps between rows, so they never run through another node.
 */
function routeBack(
  edge: IndexedEdge,
  lane: number,
  boxes: readonly Box[],
  maxRight: number,
  realCount: number,
): PositionedFlowEdge {
  const source = boxes[edge.from] ?? { x: 0, y: 0, width: 0 };
  const target = boxes[edge.to] ?? { x: 0, y: 0, width: 0 };
  const rows = boxes.slice(0, realCount);
  const laneX = maxRight + laneGap * (lane + 1);
  const below = layerGap - 10 - (lane % 3) * 3;
  const above = layerGap - below;
  const leave: FlowPoint[] = isClearRight(source, rows)
    ? [
        { x: source.x + source.width, y: source.y + nodeHeight / 2 },
        { x: laneX, y: source.y + nodeHeight / 2 },
      ]
    : [
        { x: source.x + source.width / 2, y: source.y + nodeHeight },
        { x: source.x + source.width / 2, y: source.y + nodeHeight + below },
        { x: laneX, y: source.y + nodeHeight + below },
      ];
  const enter: FlowPoint[] = isClearRight(target, rows)
    ? [
        { x: laneX, y: target.y + nodeHeight / 2 },
        { x: target.x + target.width, y: target.y + nodeHeight / 2 },
      ]
    : [
        { x: laneX, y: target.y - above },
        { x: target.x + target.width / 2, y: target.y - above },
        { x: target.x + target.width / 2, y: target.y },
      ];
  return {
    from: edge.source.from,
    to: edge.source.to,
    kind: edge.kind,
    back: true,
    points: simplify([...leave, ...enter]),
    labelAt: { x: laneX + 4, y: (leave.at(-1)?.y ?? source.y) - 4 },
    labelAnchor: 'start',
  };
}

/** Nothing else sits to the right of `box` in its row. */
function isClearRight(box: Box, rows: readonly Box[]): boolean {
  return rows.every((other) => other === box || other.y !== box.y || other.x <= box.x);
}

/** Lane numbers for back edges: short climbs sit inside long ones so they never cross. */
function laneOrder(
  edges: readonly IndexedEdge[],
  back: ReadonlySet<number>,
  layerOf: readonly number[],
): Map<number, number> {
  const span = (position: number): number => {
    const edge = edges[position];
    return Math.abs((layerOf[edge?.from ?? 0] ?? 0) - (layerOf[edge?.to ?? 0] ?? 0));
  };
  const ordered = [...back].toSorted((left, right) => span(left) - span(right) || left - right);
  return new Map(ordered.map((position, lane) => [position, lane]));
}

function neighbours(
  node: number,
  forward: readonly IndexedEdge[],
  side: 'from' | 'to',
  boxes: readonly Box[],
  nodes: readonly FlowLayoutNode[],
): number[] {
  const other = side === 'to' ? 'from' : 'to';
  const found = forward.filter((edge) => edge[other] === node).map((edge) => edge[side]);
  const unique = [...new Set(found)];
  unique.sort((left, right) => (boxes[left]?.x ?? 0) - (boxes[right]?.x ?? 0));
  return unique.map((position) => nodes[position]?.id ?? position);
}

/** Drops repeated points and the middle of straight runs. */
function simplify(points: readonly FlowPoint[]): FlowPoint[] {
  const result: FlowPoint[] = [];
  for (const point of points) {
    const last = result.at(-1);
    if (last?.x === point.x && last.y === point.y) {
      continue;
    }
    const before = result.at(-2);
    if (
      before !== undefined &&
      last !== undefined &&
      ((before.x === last.x && last.x === point.x) || (before.y === last.y && last.y === point.y))
    ) {
      result[result.length - 1] = point;
      continue;
    }
    result.push(point);
  }
  return result;
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function indices(length: number): number[] {
  return Array.from({ length }, (_, position) => position);
}

function sweepOrder(length: number, isDownward: boolean): number[] {
  const order = indices(length);
  return isDownward ? order : order.toReversed();
}

/** A small per-edge vertical offset so horizontal runs of different edges rarely coincide. */
function stagger(slot: number): number {
  return (((slot * 3) % 5) - 2) * 3;
}
