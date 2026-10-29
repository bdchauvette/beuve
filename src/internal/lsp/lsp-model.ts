/**
 * What the LSP domain hands to `src/main`: plain, serializable data with no server-specific
 * encodings. Lines are 0-based and `character` counts UTF-16 code units in the line (JavaScript
 * string indices), whatever encoding the server negotiated. Ranges are half-open.
 */

export interface Position {
  readonly line: number;
  readonly character: number;
}

export interface Range {
  readonly start: Position;
  readonly end: Position;
}

/**
 * Where something is. Files under the workspace root are given relative to it with `/`
 * separators; anything else (library typings, other checkouts, non-file URIs) stays a URI.
 */
export type FileReference =
  | { readonly kind: 'workspace'; readonly path: string }
  | { readonly kind: 'external'; readonly uri: string };

export interface LocationView {
  readonly file: FileReference;
  readonly range: Range;
}

export type DiagnosticSeverity = 'error' | 'warning' | 'information' | 'hint';

export interface DiagnosticView {
  readonly range: Range;
  /** Absent when the server didn't say; clients usually treat that as an error. */
  readonly severity: DiagnosticSeverity | undefined;
  readonly code: string | undefined;
  readonly source: string | undefined;
  readonly message: string;
  readonly tags: readonly ('unnecessary' | 'deprecated')[];
  readonly related: readonly { readonly location: LocationView; readonly message: string }[];
}

/**
 * How much to trust a diagnostics report:
 * - `fresh`: the server reported on the current text and then went quiet (or answered a pull).
 * - `assumed-unchanged`: the text changed but the server sent nothing new within the grace period;
 *   servers that skip unchanged empty reports behave like this, so the previous report stands.
 * - `timed-out`: the server was still busy (or silent) at the deadline; what it sent so far.
 */
export type DiagnosticsFreshness = 'fresh' | 'assumed-unchanged' | 'timed-out';

export interface DiagnosticsReport {
  /** The file, relative to the workspace root. */
  readonly path: string;
  readonly serverId: string;
  readonly freshness: DiagnosticsFreshness;
  readonly diagnostics: readonly DiagnosticView[];
}

/**
 * One function, method or other callable in a call hierarchy. `id` names the server's item for
 * lazy expansion via `incomingCalls`/`outgoingCalls`; it is valid while the multiplexer lives (and
 * survives server restarts on a best-effort basis), and is evicted least-recently-used.
 */
export interface CallHierarchyNode {
  readonly id: string;
  readonly name: string;
  /** LSP `SymbolKind` as a lowercase word: `function`, `method`, `constructor`, … */
  readonly kind: string;
  readonly detail: string | undefined;
  readonly file: FileReference;
  /** The whole declaration, body included. */
  readonly range: Range;
  /** The name, or what to highlight. */
  readonly selectionRange: Range;
}

/**
 * An edge in the call hierarchy. For incoming calls `node` is the caller and `callSites` are in the
 * caller's file; for outgoing calls `node` is the callee and `callSites` are in the file of the
 * node that was expanded.
 */
export interface CallHierarchyCall {
  readonly node: CallHierarchyNode;
  readonly callSites: readonly Range[];
}

export interface DocumentSymbolView {
  readonly name: string;
  readonly kind: string;
  readonly detail: string | undefined;
  readonly range: Range;
  readonly selectionRange: Range;
  readonly children: readonly DocumentSymbolView[];
}

export type ServerState = 'starting' | 'running' | 'stopping';

/** One language server process, for status displays and tests. */
export interface ServerStatus {
  readonly serverId: string;
  readonly root: string;
  readonly state: ServerState;
  readonly pid: number | undefined;
  readonly openDocuments: number;
  readonly restarts: number;
}
