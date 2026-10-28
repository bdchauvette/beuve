import type { IpcResult, OpenSessionRequest, SessionSummary } from '../contract/ipc-contract.ts';

import type { McpToolServices } from './mcp/mcp-tool-services.ts';

/** Session operations the renderer can reach. Adapters in `src/main` map domain types to the contract. */
export interface SessionServices {
  readonly list: () => Promise<IpcResult<readonly SessionSummary[]>>;
  readonly open: (request: OpenSessionRequest) => Promise<IpcResult<SessionSummary>>;
}

/**
 * Everything the IPC handlers and the MCP server delegate to: the seam where the integration
 * step composes the database and domains. Inputs reaching these are already validated.
 */
export interface MainServices {
  readonly sessions: SessionServices;
  readonly mcpTools: McpToolServices;
}
