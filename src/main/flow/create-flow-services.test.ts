import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FlowGraphResponse, FlowGraphView, IpcResult } from '#contract/ipc-contract.ts';
import { createTestRepository } from '#internal/git/testing/create-test-repository.ts';
import type { TestRepository } from '#internal/git/testing/create-test-repository.ts';
import { createLogger } from '#x/log/create-logger.ts';

import { createMainServices } from '../create-main-services.ts';
import { openAppDatabase } from '../database/open-app-database.ts';
import type { MainServices } from '../main-services.ts';

describe('flow:get-graph (integration: git + Tree-sitter, no Electron)', () => {
  let repo: TestRepository;
  let db: DatabaseSync;
  let services: MainServices;
  let sessionId: string;

  beforeEach(async () => {
    repo = createTestRepository();
    db = openAppDatabase(':memory:');
    services = createMainServices({
      db,
      logger: createLogger('test', { sink: (): void => undefined }),
      worktreeRoot: path.join(repo.scratch(), 'worktrees'),
    });
    repo.write('README.md', lines(['# test']));
    repo.write('src/flow.ts', lines(source('item * 2', 'total += 4')));
    repo.write('src/data.json', '{}\n');
    repo.commit('base');
    repo.git('switch', '--quiet', '--create', 'feature');
    repo.write('src/flow.ts', lines(source('item', 'total += 5')));
    repo.write('src/data.json', '{ "a": 1 }\n');
    repo.write('src/gone.ts', lines(['export function gone(): void {', '  return;', '}']));
    repo.commit('change flow');
    repo.git('rm', '--quiet', 'README.md');
    repo.commit('drop readme');
    repo.git('switch', '--quiet', 'main');
    const created = await services.sessions.createLocal({
      repoPath: repo.directory,
      baseRef: 'main',
      headRef: 'feature',
    });
    if (!created.ok) {
      throw new Error(created.error.message);
    }
    sessionId = created.value.id;
  });

  afterEach(async () => {
    await services.dispose();
    db.close();
    repo.cleanup();
  });

  const graphAt = async (line: number): Promise<FlowGraphView> => {
    const response = value(await services.flow.getGraph({ sessionId, path: 'src/flow.ts', line }));
    if (response.kind !== 'graph') {
      throw new Error(`no graph: ${response.failure}: ${response.message}`);
    }
    return response.graph;
  };

  it('builds the graph of the function around a line, marking the lines the review changed', async () => {
    const graph = await graphAt(11);
    expect(graph).toMatchObject({ name: 'process', startLine: 1, endLine: 37 });
    const kinds = graph.nodes.map((node) => node.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(['entry', 'exit', 'condition', 'loop', 'switch', 'case', 'try']),
    );
    expect(kinds).toEqual(expect.arrayContaining(['catch', 'finally', 'return']));
    expect(graph.edges.map((edge) => edge.kind)).toEqual(
      expect.arrayContaining(['true', 'false', 'loop-back', 'continue', 'break', 'exception']),
    );
    const changed = graph.nodes.filter((node) => node.changed);
    expect(changed.map((node) => node.label)).toEqual([
      expect.stringContaining('total += item'),
      expect.stringContaining('total += 5'),
    ]);
    expect(graph.nodes.find((node) => node.label.includes('total += 4'))).toBeUndefined();
    expect(graph.nodes.find((node) => node.kind === 'loop')?.changed).toBe(false);
  });

  it('answers any line of the function with the same graph, and a repeat from the cache', async () => {
    const first = await graphAt(11);
    expect(await graphAt(11)).toEqual(first);
    expect(await graphAt(25)).toEqual(first);
  });

  it('reports typed failures instead of rejecting', async () => {
    const failure = async (file: string, line: number): Promise<FlowGraphResponse> =>
      value(await services.flow.getGraph({ sessionId, path: file, line }));
    expect(await failure('src/flow.ts', 39)).toMatchObject({
      kind: 'failed',
      failure: 'no-function-at-line',
    });
    expect(await failure('src/data.json', 1)).toMatchObject({
      kind: 'failed',
      failure: 'unsupported-language',
    });
    expect(await failure('README.md', 1)).toMatchObject({
      kind: 'failed',
      failure: 'unsupported-language',
    });
    expect(await failure('src/gone.ts', 2)).toMatchObject({ kind: 'graph' });
    expect(
      await services.flow.getGraph({ sessionId, path: 'src/missing.ts', line: 1 }),
    ).toMatchObject({ ok: false, error: { code: 'not-found' } });
    expect(
      await services.flow.getGraph({ sessionId: 'nope', path: 'src/flow.ts', line: 1 }),
    ).toMatchObject({ ok: false });
  });

  it('refuses a function too big to draw', async () => {
    const body = Array.from(
      { length: 120 },
      (_, index) => `  if (a === ${String(index)}) { a += 1; }`,
    );
    repo.git('switch', '--quiet', 'feature');
    repo.write(
      'src/big.ts',
      lines(['export function big(a: number): number {', ...body, '  return a;', '}']),
    );
    repo.commit('add big');
    const response = value(
      await services.flow.getGraph({ sessionId, path: 'src/big.ts', line: 3 }),
    );
    expect(response).toMatchObject({ kind: 'failed', failure: 'too-large' });
  });
});

/** A function with an if/else-if chain, a loop with continue and break, a switch and a try. */
function source(accumulate: string, caseB: string): string[] {
  return [
    'export function process(items: number[], mode: string): number {',
    '  let total = 0;',
    '  if (items.length === 0) {',
    '    return -1;',
    "  } else if (mode === 'fast') {",
    '    total += 1;',
    '  } else {',
    '    total -= 1;',
    '  }',
    '  for (const item of items) {',
    '    if (item < 0) {',
    '      continue;',
    '    }',
    '    if (item > 100) {',
    '      break;',
    '    }',
    `    total += ${accumulate};`,
    '  }',
    '  switch (mode) {',
    "    case 'a':",
    '      total *= 2;',
    '      break;',
    "    case 'b':",
    `      ${caseB};`,
    '      break;',
    '    default:',
    '      total = 0;',
    '  }',
    '  try {',
    '    total = risky(total);',
    '  } catch (error) {',
    '    total = -total;',
    '  } finally {',
    '    cleanup();',
    '  }',
    '  return total;',
    '}',
  ];
}

function value<T>(result: IpcResult<T>): T {
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

function lines(content: readonly string[]): string {
  return content.map((line) => `${line}\n`).join('');
}
