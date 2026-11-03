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

/** A checked `textDocument/hover` result, its contents already reduced to Markdown. */
export interface LspHover {
  readonly markdown: string;
  readonly range: LspRange | undefined;
}

export interface LspLocation {
  readonly uri: string;
  readonly range: LspRange;
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
  readonly definition: boolean;
  readonly typeDefinition: boolean;
  readonly references: boolean;
  readonly hover: boolean;
  readonly documentSymbol: boolean;
  /** The announced `capabilities` object, for logging. */
  readonly raw: Readonly<Record<string, unknown>>;
}
