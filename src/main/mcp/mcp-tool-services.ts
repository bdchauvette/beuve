import type { Result } from '#pkg/result/result.ts';

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

/** Runs the test covering a line with trace logging (spec 5E). */
export interface TraceProbeInput {
  readonly path: string;
  readonly line: number;
  readonly testName?: string | undefined;
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

/** What the MCP tools delegate to. `src/main` composes the domains behind it. */
export interface McpToolServices {
  readonly getLspDiagnostics: (input: LspDiagnosticsInput) => Promise<McpToolOutcome>;
  readonly runImpactCheck: (input: ImpactCheckInput) => Promise<McpToolOutcome>;
  readonly runTraceProbe: (input: TraceProbeInput) => Promise<McpToolOutcome>;
  readonly readHumanReview: (input: HumanReviewInput) => Promise<McpToolOutcome>;
}
