import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import type { McpToolOutcome, McpToolServices } from './mcp-tool-services.ts';

const sessionId = z
  .string()
  .min(1)
  .max(200)
  .optional()
  .describe('Review session id. Defaults to the session open in beuve.');
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
        'Language-server diagnostics (errors, warnings) for a file in the review worktree.',
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
        'Scores marginal change impact and flags methods over the cognitive complexity limit.',
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
  return outcome.ok
    ? { content: [{ type: 'text', text: JSON.stringify(outcome.value) }] }
    : { isError: true, content: [{ type: 'text', text: outcome.error }] };
}
