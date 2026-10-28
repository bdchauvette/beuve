/** A zero-based row and column. */
export interface ImpactPoint {
  readonly row: number;
  readonly column: number;
}

/**
 * The structural syntax node ImpactGate measures (ADR 0015). Tree-sitter nodes satisfy it, so main
 * can hand over a parsed tree without this domain depending on a parser; tests can build one by hand.
 */
export interface ImpactNode {
  /** Unique within one tree. */
  readonly id: number;
  readonly type: string;
  /** Named nodes are grammar rules; unnamed ones are punctuation and keywords. */
  readonly isNamed: boolean;
  readonly text: string;
  /** This node or a descendant failed to parse. */
  readonly hasError: boolean;
  readonly startPosition: ImpactPoint;
  readonly endPosition: ImpactPoint;
  readonly children: readonly ImpactNode[];
  readonly childForFieldName: (fieldName: string) => ImpactNode | null;
}
