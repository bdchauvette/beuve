/** Why an LSP operation produced no result. Every variant is an expected failure. */
export type LspError =
  | { readonly kind: 'invalid-root'; readonly root: string; readonly reason: string }
  | { readonly kind: 'invalid-path'; readonly path: string; readonly reason: string }
  | { readonly kind: 'path-outside-root'; readonly path: string; readonly root: string }
  | {
      readonly kind: 'file-too-large';
      readonly path: string;
      readonly bytes: number;
      readonly maxBytes: number;
    }
  | { readonly kind: 'unsupported-language'; readonly path: string }
  | {
      readonly kind: 'server-not-found';
      readonly serverId: string;
      readonly command: string;
      readonly searched: readonly string[];
    }
  | { readonly kind: 'server-start-failed'; readonly serverId: string; readonly message: string }
  | {
      readonly kind: 'server-exited';
      readonly serverId: string;
      readonly exitCode: number | undefined;
      readonly signal: string | undefined;
      /** The crash budget is spent; the server won't be restarted until the window passes. */
      readonly restartsExhausted: boolean;
    }
  | { readonly kind: 'capability-missing'; readonly serverId: string; readonly capability: string }
  | {
      readonly kind: 'request-failed';
      readonly method: string;
      readonly code: number;
      readonly message: string;
    }
  | {
      readonly kind: 'request-timeout';
      readonly method: string;
      readonly timeout: Temporal.Duration;
    }
  | { readonly kind: 'request-cancelled'; readonly method: string }
  | { readonly kind: 'unexpected-response'; readonly method: string; readonly reason: string }
  | { readonly kind: 'unknown-node'; readonly nodeId: string }
  | { readonly kind: 'disposed' };
