import { describe } from 'vitest';

import type { FlowGraphResponse } from '#contract/ipc-contract.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import { lines } from '../testing/lines.ts';
import { test } from './testing/test.ts';

describe('flow:get-graph (integration: git + Tree-sitter, no Electron)', () => {
  test('builds the graph of the function around a line, marking the lines the review changed', async ({
    expect,
    graphAt,
  }) => {
    const graph = await graphAt(11);
    expect(graph).toMatchObject({ name: 'process', startLine: 1, endLine: 37 });
    const kinds = graph.nodes.map((node) => node.kind);
    expect(kinds).toStrictEqual(
      expect.arrayContaining(['entry', 'exit', 'condition', 'loop', 'switch', 'case', 'try']),
    );
    expect(kinds).toStrictEqual(expect.arrayContaining(['catch', 'finally', 'return']));
    expect(graph.edges.map((edge) => edge.kind)).toStrictEqual(
      expect.arrayContaining(['true', 'false', 'loop-back', 'continue', 'break', 'exception']),
    );
    const changed = graph.nodes.filter((node) => node.changed);
    expect(changed.map((node) => node.label)).toStrictEqual([
      expect.stringContaining('total += item'),
      expect.stringContaining('total += 5'),
    ]);
    expect(graph.nodes.find((node) => node.label.includes('total += 4'))).toBeUndefined();
    expect(graph.nodes.find((node) => node.kind === 'loop')?.changed).toBe(false);
  });

  test('answers any line of the function with the same graph, and a repeat from the cache', async ({
    expect,
    graphAt,
  }) => {
    const first = await graphAt(11);
    await expect(graphAt(11)).resolves.toStrictEqual(first);
    await expect(graphAt(25)).resolves.toStrictEqual(first);
  });

  test('reports typed failures instead of rejecting', async ({ expect, services, sessionId }) => {
    const failure = async (file: string, line: number): Promise<FlowGraphResponse> =>
      okValueFrom(await services.flow.getGraph({ sessionId, path: file, line }));
    await expect(failure('src/flow.ts', 39)).resolves.toMatchObject({
      kind: 'failed',
      failure: 'no-function-at-line',
    });
    await expect(failure('src/data.json', 1)).resolves.toMatchObject({
      kind: 'failed',
      failure: 'unsupported-language',
    });
    await expect(failure('README.md', 1)).resolves.toMatchObject({
      kind: 'failed',
      failure: 'unsupported-language',
    });
    await expect(failure('src/gone.ts', 2)).resolves.toMatchObject({ kind: 'graph' });
    await expect(
      services.flow.getGraph({ sessionId, path: 'src/missing.ts', line: 1 }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not-found' } });
    await expect(
      services.flow.getGraph({ sessionId: 'nope', path: 'src/flow.ts', line: 1 }),
    ).resolves.toMatchObject({ ok: false });
  });

  test('refuses a function too big to draw', async ({ expect, services, sessionId, repo }) => {
    const body = Array.from(
      { length: 120 },
      (_, index) => `  if (a === ${String(index)}) { a += 1; }`,
    );
    await repo.git('switch', '--quiet', 'feature');
    repo.write(
      'src/big.ts',
      lines(['export function big(a: number): number {', ...body, '  return a;', '}']),
    );
    await repo.commit('add big');
    const response = okValueFrom(
      await services.flow.getGraph({ sessionId, path: 'src/big.ts', line: 3 }),
    );
    expect(response).toMatchObject({ kind: 'failed', failure: 'too-large' });
  });
});
