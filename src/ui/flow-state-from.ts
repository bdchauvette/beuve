import type { FlowFailureKind, FlowGraphResponse, IpcResult } from '#contract/ipc-contract.ts';

import type { FlowState } from './flow-state.ts';

const flowFailureText: Readonly<Record<FlowFailureKind, string>> = {
  'unsupported-language':
    'No control-flow chart for this kind of file yet (TypeScript and JavaScript only).',
  'no-function-at-line': 'The change is not inside a function, so there is no flow to draw.',
  'too-large': 'This function is too large to draw as a chart.',
  'file-unavailable': 'The head version of this file is not readable source.',
};

/** The control-flow portal for what `flow:get-graph` answered at `path` and `line`. */
export function flowStateFrom(
  path: string,
  line: number,
  answer: IpcResult<FlowGraphResponse>,
): FlowState {
  if (!answer.ok) {
    return { path, line, status: 'error', message: answer.error.message };
  }
  if (answer.value.kind === 'graph') {
    return { path, line, status: 'ready', graph: answer.value.graph };
  }
  return { path, line, status: 'error', message: flowFailureText[answer.value.failure] };
}
