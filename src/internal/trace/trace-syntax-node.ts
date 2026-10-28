/** A zero-based row and column (UTF-16 code units). */
export interface TracePoint {
  readonly row: number;
  readonly column: number;
}

/**
 * The structural syntax node the trace planner reads (ADR 0036). Tree-sitter nodes satisfy it, so
 * main hands over a parsed tree without this domain depending on the parser (ADR 0002). Offsets
 * are UTF-16 code units into the parsed text, which is what web-tree-sitter reports for strings.
 */
export interface TraceSyntaxNode {
  /** Unique within one tree. */
  readonly id: number;
  readonly type: string;
  /** Named nodes are grammar rules; unnamed ones are punctuation and keywords. */
  readonly isNamed: boolean;
  readonly text: string;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly startPosition: TracePoint;
  readonly endPosition: TracePoint;
  readonly parent: TraceSyntaxNode | null;
  readonly children: readonly TraceSyntaxNode[];
  readonly childForFieldName: (fieldName: string) => TraceSyntaxNode | null;
}
