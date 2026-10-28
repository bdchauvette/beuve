/**
 * What to instrument in one file and how (ADR 0036): the functions enclosing a hunk, a probe per
 * traced construct, and the text insertions that make the instrumented module. Plain data.
 */
export interface InstrumentationPlan {
  /** The file as the caller named it (repository-relative). */
  readonly path: string;
  readonly functions: readonly TracedFunction[];
  /** Indexed by probe id. */
  readonly probes: readonly Probe[];
  readonly edits: readonly SourceEdit[];
}

export interface TracedFunction {
  /** Index in `functions`. */
  readonly index: number;
  /** Qualified like ImpactGate's names (`Class.method`), or `<anonymous>`. */
  readonly name: string;
  /** One-based, inclusive. */
  readonly startLine: number;
  readonly endLine: number;
}

export type ProbeKind =
  | 'enter'
  | 'if'
  | 'ternary'
  | 'switch'
  | 'case'
  | 'default'
  | 'loop'
  | 'catch'
  | 'return'
  | 'throw';

/** A place the instrumented code reports from. `line` is one-based in the original text. */
export interface Probe {
  /** Index in `probes`; the instrumented code passes it to the recorder. */
  readonly id: number;
  readonly kind: ProbeKind;
  /** Index of the enclosing traced function. */
  readonly fn: number;
  readonly line: number;
  /** A one-line source snippet: the condition, the case, the loop header, the returned expression. */
  readonly label: string;
  /** One of the construct's own lines (a condition, a loop header, a signature) is in the hunk. */
  readonly inHunk: boolean;
  /** For `enter`: the parameter names, in the order their values are reported. */
  readonly parameters?: readonly string[];
}

/**
 * Text inserted before `offset` (UTF-16 code units into the original). Insertions never contain
 * line breaks, so instrumented line numbers equal the original's and no source map is needed.
 * `side`, `span` and `order` order insertions at the same offset: closings before openings,
 * inner closings first, outer openings first (see `applyEdits`).
 */
export interface SourceEdit {
  readonly offset: number;
  readonly text: string;
  readonly side: 'open' | 'close';
  /** Length of the construct the insertion belongs to. */
  readonly span: number;
  /** Creation order; constructs are visited outer first. */
  readonly order: number;
}
