import type { positionEncodings } from './position-encodings.ts';

/**
 * The slice of the Language Server Protocol (3.17) that beuve speaks, hand-written. Values from a
 * server are `unknown` until a guard in this domain checks them; these types describe the checked
 * shape. Positions here are in the connection's negotiated encoding, not beuve's.
 */

/** How `Position.character` counts: UTF-8 bytes, UTF-16 code units (the default) or code points. */
export type PositionEncoding = (typeof positionEncodings)[keyof typeof positionEncodings];

export interface LspPosition {
  readonly line: number;
  readonly character: number;
}

export interface LspRange {
  readonly start: LspPosition;
  readonly end: LspPosition;
}

export interface LspLocation {
  readonly uri: string;
  readonly range: LspRange;
}

/** 1 error, 2 warning, 3 information, 4 hint. */
export type LspDiagnosticSeverity = 1 | 2 | 3 | 4;

export interface LspDiagnostic {
  readonly range: LspRange;
  readonly severity?: LspDiagnosticSeverity;
  readonly code?: number | string;
  readonly source?: string;
  readonly message: string;
  /** 1 unnecessary, 2 deprecated. */
  readonly tags?: readonly number[];
  readonly relatedInformation?: readonly LspRelatedInformation[];
}

export interface LspRelatedInformation {
  readonly location: LspLocation;
  readonly message: string;
}

export interface WorkspaceFolder {
  readonly uri: string;
  readonly name: string;
}

export interface LspCallHierarchyItem {
  readonly name: string;
  readonly kind: number;
  readonly tags?: readonly number[];
  readonly detail?: string;
  readonly uri: string;
  readonly range: LspRange;
  readonly selectionRange: LspRange;
  /** Opaque server data; the item must be sent back verbatim. */
  readonly data?: unknown;
}

export interface LspDocumentSymbol {
  readonly name: string;
  readonly detail?: string;
  readonly kind: number;
  readonly range: LspRange;
  readonly selectionRange: LspRange;
  readonly children?: readonly LspDocumentSymbol[];
}

/** What a server announced in its `initialize` result, reduced to what beuve consults. */
export interface LspServerCapabilities {
  readonly positionEncoding: PositionEncoding;
  readonly callHierarchy: boolean;
  readonly pullDiagnostics: boolean;
  readonly definition: boolean;
  readonly typeDefinition: boolean;
  readonly references: boolean;
  readonly hover: boolean;
  readonly documentSymbol: boolean;
  /** The announced `capabilities` object, for logging. */
  readonly raw: Readonly<Record<string, unknown>>;
}
