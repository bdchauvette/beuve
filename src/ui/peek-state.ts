import type { CallHierarchyCallView, CallHierarchyNodeView } from '#contract/ipc-contract.ts';

/** Children of one node in the peek portal, fetched lazily. */
export type PeekChildren =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly calls: readonly CallHierarchyCallView[] }
  | { readonly status: 'error'; readonly message: string };

/**
 * The call-stack peek portal of one file card: incoming callers of the function enclosing the
 * card's first change. `children` is keyed by node id, the root's included.
 */
export type PeekState = {
  readonly path: string;
  readonly line: number | undefined;
} & (
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | {
      readonly status: 'ready';
      readonly root: CallHierarchyNodeView;
      readonly children: ReadonlyMap<string, PeekChildren>;
    }
);
