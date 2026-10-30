import type { FlowGraphView } from '#contract/ipc-contract.ts';

/**
 * The control-flow portal of one file card (Show Control Flow): the graph of the function enclosing
 * head line `line`, or why there is none.
 */
export type FlowState = {
  readonly path: string;
  readonly line: number | undefined;
} & (
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly graph: FlowGraphView }
);
