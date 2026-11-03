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

/**
 * What a language server says about the symbol at a position (`textDocument/hover`): `markdown`
 * is CommonMark text the server wrote (plain text and code-tagged strings are converted to it,
 * the former as a fenced block) and `range` is the token it describes, when the server said.
 */
export interface HoverView {
  readonly markdown: string;
  readonly range: Range | undefined;
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
