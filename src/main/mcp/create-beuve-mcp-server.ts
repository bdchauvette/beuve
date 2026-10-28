import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import type { McpToolOutcome, McpToolServices } from './mcp-tool-services.ts';

const sessionId = z
  .string()
  .min(1)
  .max(200)
  .optional()
  .describe(
    'Review session id. Defaults to the session open in beuve, or the only session if just one exists.',
  );
const path = z.string().min(1).max(4096).describe('File path, relative to the repository root.');

/**
 * Builds an MCP server exposing beuve's agent tools (spec 5C). Tools only validate input and
 * delegate to `services`; one server is created per stateless HTTP request.
 */
export function createBeuveMcpServer(services: McpToolServices, version: string): McpServer {
  const server = new McpServer({ name: 'beuve', version });

  server.registerTool(
    'beuve_get_lsp_diagnostics',
    {
      title: 'LSP diagnostics',
      description:
        'Language-server diagnostics (errors, warnings) for a file, checked in a detached checkout ' +
        "of the review session's head commit (not the user's working tree). Lines and columns in " +
        'the result are 1-based (columns count UTF-16 code units). `freshness` says whether the ' +
        'server settled (`fresh`), kept its previous report (`assumed-unchanged`) or timed out.',
      inputSchema: { path, sessionId },
      annotations: { readOnlyHint: true },
    },
    async (input): Promise<CallToolResult> => toToolResult(await services.getLspDiagnostics(input)),
  );

  server.registerTool(
    'beuve_run_impact_check',
    {
      title: 'ImpactGate check',
      description:
        "ImpactGate: scores how the review diff (base to the session's head) moves the complexity " +
        'of the functions it touches, and lists findings: changed functions over the cognitive ' +
        'complexity limit, with their trend against the base. Lines are 1-based; percentiles rank ' +
        "against every head function in the review's analyzed files.",
      inputSchema: {
        sessionId,
        paths: z.array(path).max(1000).optional().describe('Limit the check to these files.'),
      },
      annotations: { readOnlyHint: true },
    },
    async (input): Promise<CallToolResult> => toToolResult(await services.runImpactCheck(input)),
  );

  server.registerTool(
    'beuve_run_trace_probe',
    {
      title: 'Trace probe',
      description: 'Runs the test covering a line with trace logging and returns its timeline.',
      inputSchema: {
        path,
        line: z.number().int().min(1).describe('1-based line number.'),
        testName: z.string().min(1).max(1000).optional().describe('Test to run, if known.'),
      },
    },
    async (input): Promise<CallToolResult> => toToolResult(await services.runTraceProbe(input)),
  );

  server.registerTool(
    'beuve_read_human_review',
    {
      title: 'Human review',
      description: "Reads the reviewer's staged comments, severities and patches (URA items).",
      inputSchema: { sessionId },
      annotations: { readOnlyHint: true },
    },
    async (input): Promise<CallToolResult> => toToolResult(await services.readHumanReview(input)),
  );

  return server;
}

function toToolResult(outcome: McpToolOutcome): CallToolResult {
  if (!outcome.ok) {
    return { isError: true, content: [{ type: 'text', text: outcome.error }] };
  }
  const content: CallToolResult['content'] = [
    { type: 'text', text: JSON.stringify(outcome.value) },
  ];
  return isRecord(outcome.value) ? { content, structuredContent: outcome.value } : { content };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
