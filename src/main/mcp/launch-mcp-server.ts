import process from 'node:process';

import type { Logger } from '#pkg/logger/create-logger.ts';

import type { McpStatus } from '../../contract/ipc-contract.ts';

import { loadMcpToken } from './load-mcp-token.ts';
import type { McpToolServices } from './mcp-tool-services.ts';
import { startMcpServer } from './start-mcp-server.ts';
import type { McpServerOptions } from './start-mcp-server.ts';
import { writeMcpDiscovery } from './write-mcp-discovery.ts';

export interface LaunchMcpServerOptions {
  /** Where the token and discovery file live: Electron's `userData` directory. */
  readonly directory: string;
  readonly services: McpToolServices;
  readonly logger: Logger;
  readonly version: string;
  /** Preferred port; if it is taken, an ephemeral one is used and the discovery file says which. */
  readonly port: number;
  readonly onStatus: (status: McpStatus) => void;
}

/**
 * Loads the token, starts the server and publishes `mcp-server.json`, reporting each step through
 * `onStatus`. Never rejects. Returns a stop function that also removes the discovery file.
 */
export async function launchMcpServer(
  options: LaunchMcpServerOptions,
): Promise<() => Promise<void>> {
  const { logger, onStatus } = options;
  const fail = (
    message: string,
    fields: Readonly<Record<string, unknown>>,
  ): (() => Promise<void>) => {
    logger.error(message, fields);
    onStatus({ state: 'failed', message });
    return doNothing;
  };

  onStatus({ state: 'starting' });
  const token = await loadMcpToken(options.directory);
  if (!token.ok) {
    return fail('could not load the MCP token', { error: token.error });
  }
  const handle = await startOnPreferredPort({ ...options, token: token.value });
  if (!handle.ok) {
    return fail('could not start the MCP server', { error: handle.error });
  }
  const discovery = await writeMcpDiscovery(options.directory, {
    schemaVersion: 1,
    name: 'beuve',
    transport: 'streamable-http',
    url: handle.value.url,
    token: token.value,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  });
  if (!discovery.ok) {
    await handle.value.stop();
    return fail('could not write the MCP discovery file', { error: discovery.error });
  }
  onStatus({ state: 'running', url: handle.value.url });
  return async (): Promise<void> => {
    await discovery.value();
    await handle.value.stop();
    onStatus({ state: 'stopped' });
  };
}

async function doNothing(): Promise<void> {
  // Nothing was started, so there is nothing to stop.
}

async function startOnPreferredPort(options: McpServerOptions): ReturnType<typeof startMcpServer> {
  const preferred = await startMcpServer(options);
  if (preferred.ok || preferred.error.code !== 'EADDRINUSE' || options.port === 0) {
    return preferred;
  }
  options.logger.warn('mcp port in use, using an ephemeral port', { port: options.port });
  return startMcpServer({ ...options, port: 0 });
}
