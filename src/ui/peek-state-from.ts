import type { CallHierarchyView, IpcResult } from '#contract/ipc-contract.ts';

import type { PeekState } from './peek-state.ts';

/** The peek portal for what `lsp:call-hierarchy` answered at `path` and `line`. */
export function peekStateFrom(
  path: string,
  line: number,
  answer: IpcResult<CallHierarchyView>,
): PeekState {
  if (!answer.ok) {
    return { path, line, status: 'error', message: answer.error.message };
  }
  const { root, calls } = answer.value;
  if (root === undefined) {
    return {
      path,
      line,
      status: 'error',
      message: 'The language server found nothing callable here.',
    };
  }
  return {
    path,
    line,
    status: 'ready',
    root,
    children: new Map([[root.id, { status: 'ready', calls }]]),
  };
}
