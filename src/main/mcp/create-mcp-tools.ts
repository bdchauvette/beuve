import type { IpcError } from '#contract/ipc-contract.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { ImpactServices } from '../impact/create-impact-services.ts';
import { narrowImpactView } from '../impact/narrow-impact-view.ts';
import type { LspServices } from '../lsp/create-lsp-services.ts';
import { resolveSessionId } from '../sessions/resolve-session-id.ts';
import type { SessionContext } from '../sessions/session-context.ts';
import type { TraceProbeFailure, TraceServices } from '../trace/create-trace-services.ts';
import type { GithubServices } from '../github/create-github-services.ts';
import type { UraServices } from '../ura/create-ura-services.ts';

import type { McpDocumentOutcome, McpToolOutcome, McpToolServices } from './mcp-tool-services.ts';

export interface McpToolsOptions {
  readonly context: SessionContext;
  readonly impact: ImpactServices;
  readonly lsp: LspServices;
  readonly ura: Pick<UraServices, 'readAgentReview'>;
  readonly trace: Pick<TraceServices, 'probe'>;
  readonly github: Pick<GithubServices, 'summaryFor'>;
  /** The session the reviewer has open in beuve, if any. */
  readonly openSessionId: () => string | undefined;
}

/**
 * The MCP tools backed by real domains: ImpactGate, LSP diagnostics, trace probes and the
 * reviewer's staged review (URA). Trace probes never ask for trust: an unapproved repository
 * fails with `untrusted` and says a human must approve it in beuve (ADR 0036, 0041).
 */
export function createMcpTools(options: McpToolsOptions): McpToolServices {
  const { context, impact, lsp, ura, trace, github, openSessionId } = options;
  const sessionFor = (requested: string | undefined): Result<string, string> =>
    resolveSessionId(context, requested, openSessionId());
  return {
    runImpactCheck: async ({ sessionId, paths }): Promise<McpToolOutcome> => {
      const id = sessionFor(sessionId);
      if (!id.ok) {
        return id;
      }
      const view = await impact.getImpact({ sessionId: id.value });
      if (!view.ok) {
        return failure(view.error);
      }
      return ok(paths === undefined ? view.value : narrowImpactView(view.value, paths));
    },
    getLspDiagnostics: async ({ sessionId, path }): Promise<McpToolOutcome> => {
      const id = sessionFor(sessionId);
      if (!id.ok) {
        return id;
      }
      const report = await lsp.diagnostics({ sessionId: id.value, path });
      return report.ok ? report : failure(report.error);
    },
    runTraceProbe: async ({ sessionId, path, line, testNamePattern }): Promise<McpToolOutcome> => {
      const id = sessionFor(sessionId);
      if (!id.ok) {
        return id;
      }
      const probed = await trace.probe({
        sessionId: id.value,
        path,
        line,
        testNamePattern,
      });
      if (!probed.ok) {
        return err(describeProbeFailure(probed.error));
      }
      const { result, testsFailed } = probed.value;
      return ok({
        sessionId: probed.value.sessionId,
        headSha: result.headSha,
        path: result.path,
        testFiles: result.testFiles,
        testsFailed,
        functions: result.functions,
        timelines: result.timelines,
        durationMs: result.durationMs,
      });
    },
    readHumanReview: async ({ sessionId }): Promise<McpDocumentOutcome> => {
      const id = sessionFor(sessionId);
      if (!id.ok) {
        return id;
      }
      const read = await ura.readAgentReview(id.value);
      return read.ok
        ? ok({
            structured: withPullRequest(read.value.review, github.summaryFor(id.value)),
            text: read.value.xml,
          })
        : err(`${read.error.code}: ${read.error.message}`);
    },
  };
}

function failure(error: IpcError): McpToolOutcome {
  return err(`${error.code}: ${error.message}`);
}

/** Adds the pull request's identity to the review for pull request sessions (additive). */
function withPullRequest(
  review: object,
  pullRequest: ReturnType<GithubServices['summaryFor']>,
): Record<string, unknown> {
  return pullRequest === undefined ? { ...review } : { ...review, pullRequest };
}

function describeProbeFailure(failure: TraceProbeFailure): string {
  return failure.failure === 'untrusted'
    ? 'untrusted: this repository is not approved to run its tests, and running them executes ' +
        "the repository's code and Vitest config on the reviewer's machine. A human must approve it " +
        'in beuve (open the session, press r on a hunk and choose "Trust and run", or type /trust ' +
        'in the chat). beuve never asks through MCP; retry after they have.'
    : `${failure.failure}: ${failure.message}`;
}
