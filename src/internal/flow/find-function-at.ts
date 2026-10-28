import type { FlowRules } from './flow-rules.ts';
import type { FlowSyntaxNode } from './flow-syntax-node.ts';

interface Visit {
  readonly node: FlowSyntaxNode;
  readonly depth: number;
}

/**
 * The innermost function enclosing the one-based `line`, or `undefined` outside any function. When
 * several functions on the line are equally deep, the first one wins.
 */
export function findFunctionAt(
  root: FlowSyntaxNode,
  line: number,
  rules: FlowRules,
): FlowSyntaxNode | undefined {
  const row = line - 1;
  let found: Visit | undefined;
  const pending: Visit[] = [{ node: root, depth: 0 }];
  for (let visit = pending.pop(); visit !== undefined; visit = pending.pop()) {
    if (
      rules.functions.includes(visit.node.type) &&
      (found === undefined || visit.depth > found.depth)
    ) {
      found = visit;
    }
    const inside = visit.node.children.filter(
      (child) => child.startPosition.row <= row && row <= child.endPosition.row,
    );
    for (const child of inside.toReversed()) {
      pending.push({ node: child, depth: visit.depth + 1 });
    }
  }
  return found?.node;
}
