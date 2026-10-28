import { describe, expect, it } from 'vitest';

import { flowLayout } from './flow-layout.ts';
import type { FlowLayout, FlowLayoutInput } from './flow-layout.ts';

const ifElse: FlowLayoutInput = {
  nodes: [
    { id: 0, kind: 'entry', label: 'check' },
    { id: 1, kind: 'exit', label: 'end' },
    { id: 2, kind: 'condition', label: 'value > limit' },
    { id: 3, kind: 'block', label: 'clamp(value)' },
    { id: 4, kind: 'return', label: 'return value' },
  ],
  edges: [
    { from: 0, to: 2, kind: 'next' },
    { from: 2, to: 3, kind: 'true' },
    { from: 2, to: 4, kind: 'false' },
    { from: 3, to: 4, kind: 'next' },
    { from: 4, to: 1, kind: 'next' },
  ],
};

const loop: FlowLayoutInput = {
  nodes: [
    { id: 0, kind: 'entry', label: 'sum' },
    { id: 1, kind: 'exit', label: 'end' },
    { id: 2, kind: 'loop', label: 'for (const x of xs)' },
    { id: 3, kind: 'condition', label: 'x < 0' },
    { id: 4, kind: 'block', label: 'total += x' },
    { id: 5, kind: 'block', label: 'continue' },
    { id: 6, kind: 'return', label: 'return total' },
  ],
  edges: [
    { from: 0, to: 2, kind: 'next' },
    { from: 2, to: 3, kind: 'true' },
    { from: 2, to: 6, kind: 'false' },
    { from: 3, to: 5, kind: 'true' },
    { from: 3, to: 4, kind: 'false' },
    { from: 4, to: 2, kind: 'loop-back' },
    { from: 5, to: 2, kind: 'continue' },
    { from: 6, to: 1, kind: 'next' },
  ],
};

describe('flowLayout', () => {
  it('returns an empty layout for an empty graph', () => {
    expect(flowLayout({ nodes: [], edges: [] })).toMatchObject({ nodes: [], edges: [] });
  });

  it('layers an if/else top to bottom and puts the exit last', () => {
    const layout = flowLayout(ifElse);
    const layer = (id: number): number => nodeOf(layout, id).layer;
    expect([0, 2, 3, 4, 1].map((id) => layer(id))).toEqual([0, 1, 2, 3, 4]);
    expect(nodeOf(layout, 3).x).toBeLessThan(nodeOf(layout, 4).x + nodeOf(layout, 4).width);
    expect(layout.edges.every((edge) => !edge.back)).toBe(true);
  });

  it('never overlaps boxes, in any fixture', () => {
    for (const input of [ifElse, loop]) {
      const layout = flowLayout(input);
      for (const [index, left] of layout.nodes.entries()) {
        const others = layout.nodes.slice(index + 1);
        for (const right of others) {
          const isApart =
            left.x + left.width <= right.x ||
            right.x + right.width <= left.x ||
            left.y + left.height <= right.y ||
            right.y + right.height <= left.y;
          expect(isApart).toBe(true);
        }
      }
    }
  });

  it('keeps every box and point inside the canvas', () => {
    const layout = flowLayout(loop);
    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x + node.width).toBeLessThanOrEqual(layout.width);
      expect(node.y + node.height).toBeLessThanOrEqual(layout.height);
    }
    const points = layout.edges.flatMap((edge) => edge.points);
    for (const point of points) {
      expect(point.x).toBeLessThanOrEqual(layout.width);
      expect(point.y).toBeLessThanOrEqual(layout.height);
    }
  });

  it('routes loop-back and continue edges down a lane right of every node', () => {
    const layout = flowLayout(loop);
    const rightmost = Math.max(...layout.nodes.map((node) => node.x + node.width));
    const backs = layout.edges.filter((edge) => edge.back);
    expect(backs.map((edge) => edge.kind).toSorted((a, b) => a.localeCompare(b))).toEqual([
      'continue',
      'loop-back',
    ]);
    for (const edge of backs) {
      expect(Math.max(...edge.points.map((point) => point.x))).toBeGreaterThan(rightmost);
      const end = edge.points.at(-1);
      const header = nodeOf(layout, 2);
      expect(end).toEqual({ x: header.x + header.width, y: header.y + header.height / 2 });
    }
    expect(nodeOf(layout, 6).layer).toBeLessThan(nodeOf(layout, 1).layer);
  });

  it('draws forward edges as orthogonal polylines from source bottom to target top', () => {
    const layout = flowLayout(ifElse);
    for (const edge of layout.edges) {
      const from = nodeOf(layout, edge.from);
      const to = nodeOf(layout, edge.to);
      expect(edge.points[0]?.y).toBe(from.y + from.height);
      expect(edge.points.at(-1)?.y).toBe(to.y);
      for (const [index, point] of edge.points.slice(1).entries()) {
        const before = edge.points[index];
        expect(before?.x === point.x || before?.y === point.y).toBe(true);
      }
    }
  });

  it('carries edges that skip layers through the gaps between boxes', () => {
    const layout = flowLayout(ifElse);
    const long = layout.edges.find((edge) => edge.from === 2 && edge.to === 4);
    const blocker = nodeOf(layout, 3);
    expect(long).toBeDefined();
    expect(nodeOf(layout, 4).layer - nodeOf(layout, 2).layer).toBe(2);
    const route = long?.points ?? [];
    for (const point of route) {
      const isInsideBlocker =
        point.x > blocker.x &&
        point.x < blocker.x + blocker.width &&
        point.y > blocker.y &&
        point.y < blocker.y + blocker.height;
      expect(isInsideBlocker).toBe(false);
    }
  });

  it('lists successors and predecessors left to right', () => {
    const layout = flowLayout(ifElse);
    expect(nodeOf(layout, 2).successors).toHaveLength(2);
    expect(nodeOf(layout, 4).predecessors.toSorted((a, b) => a - b)).toEqual([2, 3]);
    expect(nodeOf(layout, 0).predecessors).toEqual([]);
  });

  it('is deterministic', () => {
    expect(flowLayout(loop)).toEqual(flowLayout(loop));
    expect(JSON.stringify(flowLayout(ifElse))).toBe(JSON.stringify(flowLayout(ifElse)));
  });

  it('ignores edges to unknown nodes and self loops', () => {
    const layout = flowLayout({
      nodes: [{ id: 7, kind: 'entry', label: 'f' }],
      edges: [
        { from: 7, to: 7, kind: 'next' },
        { from: 7, to: 99, kind: 'next' },
      ],
    });
    expect(layout.edges).toEqual([]);
    expect(layout.nodes).toHaveLength(1);
  });

  it('grows boxes with their labels', () => {
    const layout = flowLayout({
      nodes: [
        { id: 0, kind: 'entry', label: 'f' },
        { id: 1, kind: 'block', label: 'a rather long statement label here' },
      ],
      edges: [{ from: 0, to: 1, kind: 'next' }],
    });
    expect(nodeOf(layout, 1).width).toBeGreaterThan(nodeOf(layout, 0).width);
  });
});

function nodeOf(layout: FlowLayout, id: number): FlowLayout['nodes'][number] {
  const found = layout.nodes.find((node) => node.id === id);
  if (found === undefined) {
    throw new Error(`no node ${String(id)}`);
  }
  return found;
}
