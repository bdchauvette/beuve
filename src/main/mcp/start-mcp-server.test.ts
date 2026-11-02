import { request } from 'node:http';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { describe } from 'vitest';

import type { McpServerHandle } from './start-mcp-server.ts';
import { test } from './testing/test.ts';

describe('startMcpServer', () => {
  test('binds to loopback on an ephemeral port', ({ expect, mcpServer: handle }) => {
    expect(handle.url).toBe(`http://127.0.0.1:${String(handle.port)}/mcp`);
    expect(handle.port).toBeGreaterThan(0);
  });

  test('lists the four spec tools and reports service failures as tool errors', async ({
    expect,
    closing,
    mcpServer: handle,
    mcpToken: token,
    signal,
  }) => {
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(handle.url), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
      { signal },
    );
    closing(client);
    const { tools } = await client.listTools(undefined, { signal });
    expect(tools.map((tool) => tool.name).toSorted((a, b) => a.localeCompare(b))).toStrictEqual([
      'beuve_get_lsp_diagnostics',
      'beuve_read_human_review',
    ]);

    const failed = await client.callTool(
      {
        name: 'beuve_get_lsp_diagnostics',
        arguments: { path: 'src/a.ts' },
      },
      undefined,
      { signal },
    );
    expect(failed).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'not implemented yet' }],
    });

    const passed = await client.callTool(
      { name: 'beuve_read_human_review', arguments: {} },
      undefined,
      { signal },
    );
    expect(passed).toMatchObject({
      structuredContent: { schema: 'beuve.ura/1' },
      content: [{ type: 'text', text: '<beuve-review/>' }],
    });

    const invalid = await client.callTool(
      {
        name: 'beuve_get_lsp_diagnostics',
        arguments: { path: '' },
      },
      undefined,
      { signal },
    );
    expect(invalid).toMatchObject({ isError: true });
  });

  test('rejects requests without the bearer token', async ({ expect, mcpServer: handle }) => {
    const response = await post(handle, { host: `127.0.0.1:${String(handle.port)}` });
    expect(response.status).toBe(401);
    expect(response.authenticate).toContain('Bearer');
  });

  test('rejects a wrong token', async ({ expect, mcpServer: handle }) => {
    const response = await post(handle, {
      host: `127.0.0.1:${String(handle.port)}`,
      authorization: 'Bearer nope',
    });
    expect(response.status).toBe(401);
  });

  test('rejects foreign Host headers even with the token (DNS rebinding)', async ({
    expect,
    mcpServer: handle,
    mcpToken: token,
  }) => {
    const response = await post(handle, {
      host: `evil.example:${String(handle.port)}`,
      authorization: `Bearer ${token}`,
    });
    expect(response.status).toBe(403);
  });

  test('rejects browser requests from other origins even with the token', async ({
    expect,
    mcpServer: handle,
    mcpToken: token,
  }) => {
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
