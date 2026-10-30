import type { Result } from '#x/result/result.ts';

/** Diagnostics for one file, as the LSP multiplexer reports them. */
export interface LspDiagnosticsInput {
  readonly path: string;
  readonly sessionId?: string | undefined;
}

/** ImpactGate scoring for the session's current diff, optionally narrowed to some paths. */
export interface ImpactCheckInput {
  readonly sessionId?: string | undefined;
  readonly paths?: readonly string[] | undefined;
}

/** Runs the tests covering a line with execution tracing (spec 5E, ADR 0041). */
export interface TraceProbeInput {
  readonly sessionId?: string | undefined;
  readonly path: string;
  /** 1-based head line. */
  readonly line: number;
  readonly testNamePattern?: string | undefined;
}

/** The human's staged review (URA items) for a session. */
export interface HumanReviewInput {
  readonly sessionId?: string | undefined;
}

/**
 * A tool's outcome: a JSON-serializable value, or a message the agent can act on. Failures
 * become MCP tool errors (`isError: true`), never protocol errors.
 */
export type McpToolOutcome = Result<unknown, string>;

/**
 * A tool outcome whose text content is a document of its own rather than the JSON of its
 * structured content, such as the human review as XML beside its JSON form.
 */
export type McpDocumentOutcome = Result<
  { readonly structured: Readonly<Record<string, unknown>>; readonly text: string },
  string
>;

/** What the MCP tools delegate to. `src/main` composes the domains behind it. */
export interface McpToolServices {
  readonly getLspDiagnostics: (input: LspDiagnosticsInput) => Promise<McpToolOutcome>;
  readonly runImpactCheck: (input: ImpactCheckInput) => Promise<McpToolOutcome>;
  readonly runTraceProbe: (input: TraceProbeInput) => Promise<McpToolOutcome>;
  readonly readHumanReview: (input: HumanReviewInput) => Promise<McpDocumentOutcome>;
}
