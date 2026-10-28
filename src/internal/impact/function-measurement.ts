/** One function's complexity (ADR 0015). Nested functions are measured separately. */
export interface FunctionMetrics {
  /** SonarSource cognitive complexity. */
  readonly cognitive: number;
  /** McCabe cyclomatic complexity: 1 plus decisions and boolean operators. */
  readonly cyclomatic: number;
  /** Source lines the function spans, signature to closing brace. */
  readonly lines: number;
  /** Deepest nesting of control structures; 0 for straight-line code. */
  readonly maxNesting: number;
  readonly parameters: number;
}

/** A measured function, as plain data. Lines are 1-based and inclusive. */
export interface FunctionMeasurement {
  /** Qualified name: scopes and enclosing functions joined by `.`, `#n` for the nth duplicate. */
  readonly name: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly metrics: FunctionMetrics;
  /** Digest of the whitespace-normalized function text, to tell changed from unchanged. */
  readonly textHash: string;
  /** Digest of the whitespace-normalized body alone, to pair renamed functions. */
  readonly bodyHash: string;
  /** Length of the normalized body; tiny bodies are too common to identify a rename. */
  readonly bodyLength: number;
}

/** Every function in one source, in source order. */
export interface SourceMeasurement {
  readonly functions: readonly FunctionMeasurement[];
  /** The source had syntax errors; metrics near them may be off. */
  readonly parseErrors: boolean;
}
