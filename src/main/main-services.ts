import type {
  CreateLocalSessionRequest,
  GetReviewRequest,
  IpcResult,
  MarkReviewedRequest,
  OpenSessionRequest,
  ReviewView,
  SessionSummary,
} from '#contract/ipc-contract.ts';

import type { McpToolServices } from './mcp/mcp-tool-services.ts';

/** Session operations the renderer can reach. Adapters in `src/main` map domain types to the contract. */
export interface SessionServices {
  readonly list: () => IpcResult<readonly SessionSummary[]>;
  readonly open: (request: OpenSessionRequest) => IpcResult<SessionSummary>;
  readonly createLocal: (request: CreateLocalSessionRequest) => Promise<IpcResult<SessionSummary>>;
  readonly getReview: (request: GetReviewRequest) => Promise<IpcResult<ReviewView>>;
  readonly markReviewed: (request: MarkReviewedRequest) => Promise<IpcResult<SessionSummary>>;
}

/**
 * Everything the IPC handlers and the MCP server delegate to: the seam where `src/main` composes
 * the database and domains. Inputs reaching these are already validated for shape.
 */
export interface MainServices {
  readonly sessions: SessionServices;
  readonly mcpTools: McpToolServices;
}
