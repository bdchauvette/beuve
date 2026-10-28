export type FlowNodeKind =
  | 'entry'
  | 'exit'
  | 'block'
  | 'condition'
  | 'loop'
  | 'switch'
  | 'case'
  | 'try'
  | 'catch'
  | 'finally'
  | 'return'
  | 'throw';

export type FlowEdgeKind =
  | 'next'
  | 'true'
  | 'false'
  | 'case'
  | 'default'
  | 'loop-back'
  | 'break'
  | 'continue'
  | 'exception'
  | 'finally';

export interface FlowGraphNode {
  /** Unique within the graph; creation order, so the entry is 0. */
  readonly id: number;
  readonly kind: FlowNodeKind;
  /** A short source snippet, never longer than a line. */
  readonly label: string;
  /** One-based, inclusive. */
  readonly startLine: number;
  readonly endLine: number;
  /** One of the node's own lines is in the changed set. */
  readonly changed: boolean;
}

export interface FlowGraphEdge {
  readonly from: number;
  readonly to: number;
  readonly kind: FlowEdgeKind;
}

/** The control flow of one function as plain, structured-clone-safe data (ADR 0028). */
export interface ControlFlowGraph {
  /** The function's own or assigned name; empty when it has none. */
  readonly name: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly nodes: readonly FlowGraphNode[];
  readonly edges: readonly FlowGraphEdge[];
}

/** Why no graph was built. */
export type FlowFailure =
  | { readonly kind: 'too-large'; readonly nodeLimit: number }
  | { readonly kind: 'unsupported'; readonly reason: string };
