/** Why a trace probe produced no timeline. Every variant is an expected failure. */
export type TraceError =
  /** The caller has not confirmed that the repository may run its own code (ADR 0036). */
  | { readonly kind: 'untrusted' }
  | { readonly kind: 'invalid-path'; readonly path: string; readonly reason: string }
  | { readonly kind: 'vitest-not-found'; readonly searched: string }
  /** No selected test file matched the project's Vitest config, or none was given. */
  | { readonly kind: 'no-tests'; readonly testFiles: readonly string[] }
  | { readonly kind: 'timeout'; readonly timeoutMs: number }
  | { readonly kind: 'cancelled' }
  /** Vitest ended without a report; `output` is the tail of its stdout and stderr. */
  | {
      readonly kind: 'run-failed';
      readonly exitCode: number | undefined;
      readonly signal: string | undefined;
      readonly output: string;
    };
