import { request } from 'node:http';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createLogger } from '#pkg/logger/create-logger.ts';
import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';

import type { McpToolServices } from './mcp-tool-services.ts';
import { startMcpServer } from './start-mcp-server.ts';
import type { McpServerHandle } from './start-mcp-server.ts';

const token = 'test-token-0123456789abcdefghijklmnopqrstuvwxyz';
const notImplemented = Promise.resolve(err('not implemented yet'));
const passing = Promise.resolve(ok({ breaches: [] }));
const services: McpToolServices = {
  getLspDiagnostics: async () => notImplemented,
  runImpactCheck: async () => passing,
  runTraceProbe: async () => notImplemented,
  readHumanReview: async () => notImplemented,
};

describe('startMcpServer', () => {
  let handle: McpServerHandle;

  beforeEach(async () => {
    const started = await startMcpServer({
      token,
      services,
      logger: createLogger('test', { sink: (): void => undefined }),
      version: '0.0.0-test',
      port: 0,
    });
    if (!started.ok) {
      throw new Error(started.error.message);
    }
    handle = started.value;
  });

  afterEach(async () => {
    await handle.stop();
  });

  it('binds to loopback on an ephemeral port', () => {
    expect(handle.url).toBe(`http://127.0.0.1:${String(handle.port)}/mcp`);
    expect(handle.port).toBeGreaterThan(0);
  });

  it('lists the four spec tools and reports service failures as tool errors', async () => {
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(handle.url), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
    );
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).toSorted((a, b) => a.localeCompare(b))).toEqual([
        'beuve_get_lsp_diagnostics',
        'beuve_read_human_review',
        'beuve_run_impact_check',
        'beuve_run_trace_probe',
      ]);

      const failed = await client.callTool({
        name: 'beuve_get_lsp_diagnostics',
        arguments: { path: 'src/a.ts' },
      });
      expect(failed).toMatchObject({
        isError: true,
        content: [{ type: 'text', text: 'not implemented yet' }],
      });

      const passed = await client.callTool({ name: 'beuve_run_impact_check', arguments: {} });
      expect(passed).toMatchObject({ content: [{ type: 'text', text: '{"breaches":[]}' }] });

      const invalid = await client.callTool({
        name: 'beuve_run_trace_probe',
        arguments: { path: 'src/a.ts', line: 0 },
      });
      expect(invalid).toMatchObject({ isError: true });
    } finally {
      await client.close();
    }
  });

  it('rejects requests without the bearer token', async () => {
    const response = await post(handle, { host: `127.0.0.1:${String(handle.port)}` });
    expect(response.status).toBe(401);
    expect(response.authenticate).toContain('Bearer');
  });

  it('rejects a wrong token', async () => {
    const response = await post(handle, {
      host: `127.0.0.1:${String(handle.port)}`,
      authorization: 'Bearer nope',
    });
    expect(response.status).toBe(401);
  });

  it('rejects foreign Host headers even with the token (DNS rebinding)', async () => {
    const response = await post(handle, {
      host: `evil.example:${String(handle.port)}`,
      authorization: `Bearer ${token}`,
    });
    expect(response.status).toBe(403);
  });

  it('rejects browser requests from other origins even with the token', async () => {
    const response = await post(handle, {
      host: `localhost:${String(handle.port)}`,
      origin: 'https://evil.example',
      authorization: `Bearer ${token}`,
    });
    expect(response.status).toBe(403);
  });
});

interface RawResponse {
  readonly status: number | undefined;
  readonly authenticate: string | undefined;
}

async function post(
  handle: McpServerHandle,
  headers: Readonly<Record<string, string>>,
): Promise<RawResponse> {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  return new Promise((resolve, reject) => {
    const outgoing = request(
      handle.url,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...headers,
        },
      },
      (response) => {
        response.resume();
        resolve({
          status: response.statusCode,
          authenticate: response.headers['www-authenticate'],
        });
      },
    );
    outgoing.once('error', reject);
    outgoing.end(body);
  });
}
