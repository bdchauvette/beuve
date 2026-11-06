import type { DiagnosticsView } from '#contract/ipc-contract.ts';

/**
 * What the renderer knows of one file's diagnostics (ADR 0111): the question is in flight, the
 * servers answered, or asking failed (a server that isn't installed, say), which shows nothing.
 */
export type FileDiagnostics =
  | { readonly kind: 'checking' }
  | { readonly kind: 'ready'; readonly view: DiagnosticsView }
  | { readonly kind: 'failed' };

/** `beuve-diagnostics-wanted`: a card shows this file, so its diagnostics are wanted. */
export interface DiagnosticsWantedDetail {
  /** Repository-relative path with `/` separators. */
  readonly path: string;
}
