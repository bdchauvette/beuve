/** A zero-based row and column (UTF-16 code units). */
export interface SyntaxPoint {
  readonly row: number;
  readonly column: number;
}

/**
 * The part of a Tree-sitter node the rest of beuve may rely on. Nodes are only valid inside the
 * callback that receives them (see `createSyntaxParser`): copy out plain data, never keep a node.
 */
export interface SyntaxNode {
  /** Unique within one tree. */
  readonly id: number;
  readonly type: string;
  readonly isNamed: boolean;
  /** This node or a descendant is an `ERROR` or `MISSING` node. */
  readonly hasError: boolean;
  readonly text: string;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly startPosition: SyntaxPoint;
  readonly endPosition: SyntaxPoint;
  readonly parent: SyntaxNode | null;
  readonly children: readonly SyntaxNode[];
  readonly namedChildren: readonly SyntaxNode[];
  readonly childForFieldName: (fieldName: string) => SyntaxNode | null;
}
