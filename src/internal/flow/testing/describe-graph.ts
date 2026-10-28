import type { ControlFlowGraph } from '../control-flow-graph.ts';

/**
 * Renders a graph as sorted `kind:label -edge-> kind:label` lines, so tests read the flow instead
 * of node ids. Test-only (ADR 0013).
 */
export function describeGraph(graph: ControlFlowGraph): string[] {
  const names = new Map(graph.nodes.map((node) => [node.id, `${node.kind}:${node.label}`]));
  const nameOf = (id: number): string => names.get(id) ?? String(id);
  return graph.edges
    .map((edge) => `${nameOf(edge.from)} -${edge.kind}-> ${nameOf(edge.to)}`)
    .toSorted((left, right) => left.localeCompare(right));
}
