import type { IpcError } from '#contract/ipc-contract.ts';
import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

import type { ImpactServices } from '../impact/create-impact-services.ts';
import { narrowImpactView } from '../impact/narrow-impact-view.ts';
import type { LspServices } from '../lsp/create-lsp-services.ts';
import { resolveSessionId } from '../sessions/resolve-session-id.ts';
import type { SessionContext } from '../sessions/session-context.ts';
import type { UraServices } from '../ura/create-ura-services.ts';

import type { McpDocumentOutcome, McpToolOutcome, McpToolServices } from './mcp-tool-services.ts';
import { unimplementedMcpTools } from './unimplemented-mcp-tools.ts';

export interface McpToolsOptions {
  readonly context: SessionContext;
  readonly impact: ImpactServices;
  readonly lsp: LspServices;
  readonly ura: Pick<UraServices, 'readAgentReview'>;
  /** The session the reviewer has open in beuve, if any. */
  readonly openSessionId: () => string | undefined;
}

/**
 * The MCP tools backed by real domains: ImpactGate, LSP diagnostics and the reviewer's staged
 * review (URA). Trace probes are not built yet and still answer "not implemented".
 */
export function createMcpTools(options: McpToolsOptions): McpToolServices {
  const { context, impact, lsp, ura, openSessionId } = options;
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
    runTraceProbe: unimplementedMcpTools.runTraceProbe,
    readHumanReview: async ({ sessionId }): Promise<McpDocumentOutcome> => {
      const id = sessionFor(sessionId);
      if (!id.ok) {
        return id;
      }
      const read = await ura.readAgentReview(id.value);
      return read.ok
        ? ok({ structured: { ...read.value.review }, text: read.value.xml })
        : err(`${read.error.code}: ${read.error.message}`);
    },
  };
}

function failure(error: IpcError): McpToolOutcome {
  return err(`${error.code}: ${error.message}`);
}
