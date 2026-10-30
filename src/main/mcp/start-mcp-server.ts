import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import type { Logger } from '#x/log/create-logger.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { checkMcpRequest } from './check-mcp-request.ts';
import { createBeuveMcpServer } from './create-beuve-mcp-server.ts';
import type { McpToolServices } from './mcp-tool-services.ts';

export interface McpServerOptions {
  readonly token: string;
  readonly services: McpToolServices;
  readonly logger: Logger;
  readonly version: string;
  /** TCP port on 127.0.0.1; 0 picks a free one. */
  readonly port: number;
}

export interface McpServerHandle {
  /** The Streamable HTTP endpoint, e.g. `http://127.0.0.1:47291/mcp`. */
  readonly url: string;
  readonly port: number;
  readonly stop: () => Promise<void>;
}

export interface McpServerStartError {
  /** Node's error code, e.g. `EADDRINUSE`, when there is one. */
  readonly code: string | undefined;
  readonly message: string;
}

const endpointPath = '/mcp';
const loopback = '127.0.0.1';

/**
 * Serves beuve's MCP tools over Streamable HTTP on 127.0.0.1 only, in stateless mode: every POST
 * gets a fresh server and transport. Needs nothing from Electron, so it runs under plain Node.
 */
export async function startMcpServer(
  options: McpServerOptions,
): Promise<Result<McpServerHandle, McpServerStartError>> {
  let port = options.port;
  const httpServer = createServer((request, response) => {
    void handleRequest(request, response, { ...options, port });
  });
  const listening = await listen(httpServer, options.port);
  if (!listening.ok) {
    return listening;
  }
  port = listening.value;
  const url = `http://${loopback}:${String(port)}${endpointPath}`;
  options.logger.info('mcp server listening', { url });
  return ok({ url, port, stop: async (): Promise<void> => close(httpServer) });
}

async function listen(
  httpServer: Server,
  port: number,
): Promise<Result<number, McpServerStartError>> {
  return new Promise((resolve) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      resolve(err({ code: error.code, message: error.message }));
    };
    httpServer.once('error', onError);
    httpServer.listen(port, loopback, () => {
      httpServer.off('error', onError);
      resolve(ok((httpServer.address() as AddressInfo).port));
    });
  });
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: McpServerOptions,
): Promise<void> {
  const { pathname } = new URL(request.url ?? '/', `http://${loopback}`);
  if (pathname !== endpointPath) {
    reply(response, 404, 'not found');
    return;
  }
  const admitted = checkMcpRequest(
    {
      host: request.headers.host,
      origin: request.headers.origin,
      authorization: request.headers.authorization,
    },
    options,
  );
  if (!admitted.ok) {
    options.logger.warn('mcp request rejected', { reason: admitted.error.reason });
    reply(response, admitted.error.status, admitted.error.reason);
    return;
  }
  const server = createBeuveMcpServer(options.services, options.version);
  const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
  response.once('close', () => {
    void Promise.allSettled([transport.close(), server.close()]);
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(request, response);
  } catch (error: unknown) {
    options.logger.error('mcp request failed', { error });
    if (!response.headersSent) {
      reply(response, 500, 'internal error');
    }
  }
}

function reply(response: ServerResponse, status: number, message: string): void {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (status === 401) {
    headers['www-authenticate'] = 'Bearer realm="beuve"';
  }
  response.writeHead(status, headers).end(JSON.stringify({ error: message }));
}

async function close(httpServer: Server): Promise<void> {
  return new Promise((resolve) => {
    httpServer.close(() => {
      resolve();
    });
    httpServer.closeAllConnections();
  });
}
