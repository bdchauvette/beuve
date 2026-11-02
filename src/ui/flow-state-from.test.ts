import { describe } from 'vitest';

import type { FlowFailureKind, FlowGraphResponse, IpcResult } from '#contract/ipc-contract.ts';

import { flowStateFrom } from './flow-state-from.ts';
import { test } from './testing/test.ts';

function ok(value: unknown): IpcResult<FlowGraphResponse> {
  return { ok: true, value: value as FlowGraphResponse };
}

describe('flowStateFrom', () => {
  test('shows an error that main reported', ({ expect }) => {
    const answer: IpcResult<FlowGraphResponse> = {
      ok: false,
      error: { code: 'invalid-request', message: 'gone' },
    };
    expect(flowStateFrom('a.ts', 2, answer)).toStrictEqual({
      path: 'a.ts',
      line: 2,
      status: 'error',
      message: 'gone',
    });
  });

  test('shows the graph', ({ expect }) => {
    const graph = { nodes: [] };
    expect(flowStateFrom('a.ts', 2, ok({ kind: 'graph', graph }))).toStrictEqual({
      path: 'a.ts',
      line: 2,
      status: 'ready',
      graph,
    });
  });

  test.for([
    ['unsupported-language', 'TypeScript and JavaScript only'],
    ['no-function-at-line', 'not inside a function'],
    ['too-large', 'too large'],
    ['file-unavailable', 'not readable source'],
  ] as const)('explains %s', ([failure, text], { expect }) => {
    const kind: FlowFailureKind = failure;
    const state = flowStateFrom('a.ts', 2, ok({ kind: 'failed', failure: kind }));
    expect(state.status).toBe('error');
    expect(state.status === 'error' && state.message).toContain(text);
  });
});
