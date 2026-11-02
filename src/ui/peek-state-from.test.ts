import { describe } from 'vitest';

import type { CallHierarchyView, IpcResult } from '#contract/ipc-contract.ts';

import { peekStateFrom } from './peek-state-from.ts';
import { test } from './testing/test.ts';

function ok(value: unknown): IpcResult<CallHierarchyView> {
  return { ok: true, value: value as CallHierarchyView };
}

describe('peekStateFrom', () => {
  test('shows an error that main reported', ({ expect }) => {
    const answer: IpcResult<CallHierarchyView> = {
      ok: false,
      error: { code: 'invalid-request', message: 'no server' },
    };
    expect(peekStateFrom('a.ts', 3, answer)).toStrictEqual({
      path: 'a.ts',
      line: 3,
      status: 'error',
      message: 'no server',
    });
  });

  test('says when nothing callable was found', ({ expect }) => {
    expect(peekStateFrom('a.ts', 3, ok({ root: undefined, calls: [] }))).toStrictEqual({
      path: 'a.ts',
      line: 3,
      status: 'error',
      message: 'The language server found nothing callable here.',
    });
  });

  test('keys the root’s callers by its id', ({ expect }) => {
    const root = { id: 'n1' };
    const calls = [{ from: 'n2' }];
    const state = peekStateFrom('a.ts', 3, ok({ root, calls }));
    expect(state).toMatchObject({ path: 'a.ts', line: 3, status: 'ready', root });
    expect(state.status === 'ready' && state.children.get('n1')).toStrictEqual({
      status: 'ready',
      calls,
    });
  });
});
