/** A zero-based row and column. */
export interface FlowPoint {
  readonly row: number;
  readonly column: number;
}

/**
 * The structural syntax node the flow domain reads (ADR 0028). Tree-sitter nodes satisfy it, so
 * main can hand over a parsed tree without this domain depending on the parser (ADR 0002).
 */
export interface FlowSyntaxNode {
  /** Unique within one tree. */
  readonly id: number;
  readonly type: string;
  /** Named nodes are grammar rules; unnamed ones are punctuation and keywords. */
  readonly isNamed: boolean;
  readonly text: string;
  readonly startPosition: FlowPoint;
  readonly endPosition: FlowPoint;
  readonly parent: FlowSyntaxNode | null;
  readonly children: readonly FlowSyntaxNode[];
  readonly childForFieldName: (fieldName: string) => FlowSyntaxNode | null;
}
