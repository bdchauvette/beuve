import { buildControlFlowGraph } from '../build-control-flow-graph.ts';
import type { ControlFlowGraph } from '../control-flow-graph.ts';
import { ecmascriptFlowRules } from '../ecmascript-flow-rules.ts';
import { findFunctionAt } from '../find-function-at.ts';
import { parseTestSource } from './parse-test-source.ts';

export interface TestGraphOptions {
  readonly line?: number;
  readonly changedLines?: readonly number[];
}

/** Parses `source` and builds the graph of the function at `line` (default 1). Test-only (ADR 0013). */
export async function buildTestGraph(
  source: string,
  options: TestGraphOptions = {},
): Promise<ControlFlowGraph> {
  const root = await parseTestSource(source.trim());
  const found = findFunctionAt(root, options.line ?? 1, ecmascriptFlowRules);
  if (found === undefined) {
    throw new Error('no function at that line');
  }
  const result = buildControlFlowGraph(found, ecmascriptFlowRules, {
    changedLines: new Set(options.changedLines),
  });
  if (!result.ok) {
    throw new Error(`no graph: ${result.error.kind}`);
  }
  return result.value;
}
