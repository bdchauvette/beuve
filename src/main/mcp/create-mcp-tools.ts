import type { IpcError } from '#contract/ipc-contract.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { ImpactServices } from '../impact/create-impact-services.ts';
import { narrowImpactView } from '../impact/narrow-impact-view.ts';
import type { LspServices } from '../lsp/create-lsp-services.ts';
import { resolveSessionId } from '../sessions/resolve-session-id.ts';
import type { SessionContext } from '../sessions/session-context.ts';
import type { GithubServices } from '../github/create-github-services.ts';
import type { UraServices } from '../ura/create-ura-services.ts';

import type { McpDocumentOutcome, McpToolOutcome, McpToolServices } from './mcp-tool-services.ts';

export interface McpToolsOptions {
  readonly context: SessionContext;
  readonly impact: ImpactServices;
  readonly lsp: LspServices;
  readonly ura: Pick<UraServices, 'readAgentReview'>;
  readonly github: Pick<GithubServices, 'summaryFor'>;
  /** The session the reviewer has open in beuve, if any. */
  readonly openSessionId: () => string | undefined;
}

/**
 * The MCP tools backed by real domains: ImpactGate, LSP diagnostics and the
 * reviewer's staged review (URA).
 */
export function createMcpTools(options: McpToolsOptions): McpToolServices {
  const { context, impact, lsp, ura, github, openSessionId } = options;
  const sessionFor = (requested: string | undefined): Result<string, string> => {
    return resolveSessionId(context, { requested, openSessionId: openSessionId() });
  };
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
      if (paths === undefined) {
        return ok(view.value);
      }
      return ok(narrowImpactView(view.value, paths));
    },
    getLspDiagnostics: async ({ sessionId, path }): Promise<McpToolOutcome> => {
      const id = sessionFor(sessionId);
      if (!id.ok) {
        return id;
      }
      const report = await lsp.diagnostics({ sessionId: id.value, path });
      if (report.ok) {
        return report;
      }
      return failure(report.error);
    },
    readHumanReview: async ({ sessionId }): Promise<McpDocumentOutcome> => {
      const id = sessionFor(sessionId);
      if (!id.ok) {
        return id;
      }
      const read = await ura.readAgentReview(id.value);
      if (read.ok) {
        return ok({
          structured: withPullRequest(read.value.review, github.summaryFor(id.value)),
          text: read.value.xml,
        });
      }
      return err(`${read.error.code}: ${read.error.message}`);
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
  if (pullRequest === undefined) {
    return { ...review };
  }
  return { ...review, pullRequest };
}
