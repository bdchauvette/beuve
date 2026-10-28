import type { TraceFailureKind, TraceResultView } from '#contract/ipc-contract.ts';

/**
 * The trace timeline portal of one file card (`r`): the probe for the hunk around head line
 * `line` of `path` while it runs, the prompt asking to trust the repository, why there is no
 * trace, or the trace itself. A failing test still shows its trace, with a `note`.
 */
export type TraceState = {
  readonly path: string;
  readonly line: number | undefined;
} & (
  | { readonly status: 'loading'; readonly testFiles: readonly string[] | undefined }
  | { readonly status: 'needs-trust'; readonly repositoryPath: string }
  | {
      readonly status: 'error';
      readonly failure: TraceFailureKind | 'local';
      readonly message: string;
    }
  | {
      readonly status: 'ready';
      readonly result: TraceResultView;
      readonly note: string | undefined;
    }
);
