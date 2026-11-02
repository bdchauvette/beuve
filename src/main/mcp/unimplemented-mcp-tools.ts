import { err } from '#x/result/err.ts';
import type { Err } from '#x/result/result.ts';

import type { McpToolServices } from './mcp-tool-services.ts';

const notImplementedResult: Promise<Err<string>> = Promise.resolve(
  err('not implemented yet: beuve has not wired this tool to its domains'),
);

/**
 * MCP tools whose domains (LSP, URA) don't exist yet: every call fails
 * honestly with a "not implemented yet" tool error. Never fakes data.
 */
export const unimplementedMcpTools: McpToolServices = Object.freeze({
  getLspDiagnostics: notImplemented,
  readHumanReview: notImplemented,
});

async function notImplemented(): Promise<Err<string>> {
  return notImplementedResult;
}
